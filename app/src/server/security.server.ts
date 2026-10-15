import { createOTP } from '@better-auth/utils/otp'
import { symmetricDecrypt } from 'better-auth/crypto'
import { auth } from './auth.server'
import { db } from './db.server'

// A session is "strong" once a second factor was used: TOTP (at sign-in or as a step-up after a
// social sign-in) or a passkey. Every workspace action requires a strong session.

export type SecondFactor = 'totp' | 'passkey'

export function factorsOf(userId: string) {
  const totp = Boolean((db().prepare('SELECT twoFactorEnabled AS e FROM user WHERE id = ?').get(userId) as { e: number | null } | undefined)?.e)
  const passkeys = (db().prepare('SELECT COUNT(*) AS n FROM passkey WHERE userId = ?').get(userId) as { n: number }).n
  return { totp, passkeys, any: totp || passkeys > 0 }
}

export function sessionFactor(token: string): SecondFactor | null {
  return ((db().prepare('SELECT mfa FROM session WHERE token = ?').get(token) as { mfa: string | null } | undefined)?.mfa ?? null) as SecondFactor | null
}

function markSession(token: string, factor: SecondFactor) {
  db().prepare('UPDATE session SET mfa = ? WHERE token = ?').run(factor, token)
}

const attempts = new Map<string, { count: number; reset: number }>()

/** Verifies a TOTP code for an already signed-in user and upgrades the session. */
export async function stepUpWithTotp(userId: string, sessionToken: string, code: string) {
  const now = Date.now()
  const a = attempts.get(userId)
  if (a && a.reset > now && a.count >= 5) throw new Error('Too many attempts — wait a minute and try again')
  const row = db().prepare('SELECT secret FROM twoFactor WHERE userId = ?').get(userId) as { secret: string } | undefined
  if (!row) throw new Error('No authenticator app is set up for this account')
  const ctx = await auth().$context
  const secret = await symmetricDecrypt({ key: ctx.secretConfig, data: row.secret })
  if (!(await createOTP(secret).verify(code.trim()))) {
    attempts.set(userId, { count: (a && a.reset > now ? a.count : 0) + 1, reset: a && a.reset > now ? a.reset : now + 60_000 })
    throw new Error('Invalid code')
  }
  attempts.delete(userId)
  markSession(sessionToken, 'totp')
}

/** After registering a passkey in this session, treat the session as passkey-verified. */
export function upgradeAfterPasskeyRegistration(userId: string, sessionToken: string) {
  const recent = db().prepare('SELECT 1 FROM passkey WHERE userId = ? AND createdAt > ?').get(userId, new Date(Date.now() - 5 * 60_000).toISOString())
  if (!recent) throw new Error('No recently registered passkey')
  markSession(sessionToken, 'passkey')
}

/** Platform-admin recovery for a lost device: removes TOTP + passkeys and signs the user out everywhere. */
export function resetSecondFactors(userId: string) {
  db().transaction(() => {
    db().prepare('DELETE FROM twoFactor WHERE userId = ?').run(userId)
    db().prepare('DELETE FROM passkey WHERE userId = ?').run(userId)
    db().prepare('UPDATE user SET twoFactorEnabled = 0 WHERE id = ?').run(userId)
    db().prepare('DELETE FROM session WHERE userId = ?').run(userId)
  })()
}

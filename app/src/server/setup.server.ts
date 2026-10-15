import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { decrypt, encrypt } from './crypto.server'
import { db, getSetting, setSetting } from './db.server'
import { env } from './env.server'

// First-run onboarding. Until someone claims the console, anyone who can reach the URL could
// become its admin — so claiming needs a one-time setup code that is only printed in the
// server logs (or set explicitly with SETUP_CODE).
//
// settings.onboarding: 'pending' while the first admin is still going through the wizard,
// 'done' afterwards (or for installs seeded from ADMIN_EMAIL / older versions).

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I

export function hasUsers() {
  return (db().prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n > 0
}

export function onboardingState(): 'claim' | 'pending' | 'done' {
  if (!hasUsers()) return 'claim'
  return getSetting('onboarding') === 'pending' ? 'pending' : 'done'
}

function normalize(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function currentCode(): string {
  if (env.setupCode) return env.setupCode
  const enc = getSetting('setup_code_enc')
  if (enc) return decrypt(enc)
  const raw = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  const code = raw.match(/.{4}/g)!.join('-')
  setSetting('setup_code_enc', encrypt(code))
  return code
}

/** Called at boot: prints the setup code while the console is unclaimed; marks existing installs as onboarded. */
export function announceSetup() {
  if (hasUsers()) {
    if (!getSetting('onboarding')) setSetting('onboarding', 'done')
    return
  }
  const code = currentCode()
  const line = '─'.repeat(64)
  console.log(
    [
      '',
      line,
      '  Convex Backup Console is ready to be set up.',
      `  Open ${env.publicUrl}/setup and enter this setup code:`,
      '',
      `      ${env.setupCode ? '(the SETUP_CODE environment variable)' : code}`,
      '',
      '  The code is valid until the first admin account is created.',
      line,
      '',
    ].join('\n'),
  )
}

const attempts = { count: 0, reset: 0 }

/** Throws unless `code` is the current setup code. Rate limited (10 tries per minute, process-wide). */
export function checkSetupCode(code: string) {
  const now = Date.now()
  if (attempts.reset < now) Object.assign(attempts, { count: 0, reset: now + 60_000 })
  if (++attempts.count > 10) throw new Error('Too many attempts — wait a minute and try again')
  const a = createHash('sha256').update(normalize(code)).digest()
  const b = createHash('sha256').update(normalize(currentCode())).digest()
  if (!timingSafeEqual(a, b)) throw new Error("That setup code isn't right. It's printed in the console's logs.")
}

export function finishClaim() {
  setSetting('setup_code_enc', '')
  setSetting('onboarding', 'pending')
}

export function finishOnboarding() {
  setSetting('onboarding', 'done')
}

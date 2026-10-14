import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { admin } from 'better-auth/plugins/admin'
import { organization } from 'better-auth/plugins/organization'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { ac, roles } from './access'
import { db } from './db.server'
import { env } from './env.server'
import { sendInvitationEmail } from './mail.server'

function authOptions() {
  return {
    appName: 'Convex Backup Console',
    database: db(),
    secret: env.authSecret,
    baseURL: env.publicUrl,
    trustedOrigins: [env.publicUrl],
    // Accounts are only created by the first-boot seed or by accepting an invitation.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60 },
    rateLimit: {
      enabled: true,
      storage: 'database' as const,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: env.publicUrl.startsWith('https://'),
      // Behind Cloudflare Tunnel the real client IP arrives in cf-connecting-ip.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },
    plugins: [
      twoFactor({ issuer: 'Convex Backup Console' }),
      // Platform admins (user.role = 'admin') create workspaces and manage users.
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        allowUserToCreateOrganization: (user) => (user as { role?: string }).role === 'admin',
        invitationExpiresIn: 7 * 24 * 60 * 60,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: (data) => sendInvitationEmail(data),
      }),
      tanstackStartCookies(),
    ],
  } satisfies BetterAuthOptions
}

function createAuth() {
  return betterAuth(authOptions())
}

type Auth = ReturnType<typeof createAuth>
const g = globalThis as { __auth?: Auth }

export function auth(): Auth {
  return (g.__auth ??= createAuth())
}

export async function migrateAuth() {
  // Uses the options directly so the auth instance isn't created (and schema-checked) before tables exist.
  const { runMigrations } = await getMigrations(authOptions())
  await runMigrations()
}

/** Creates a user with a password directly (sign-up is disabled). */
export async function createUserWithPassword(input: { email: string; name: string; password: string; role?: 'admin' | 'user' }) {
  const ctx = await auth().$context
  const user = await ctx.internalAdapter.createUser(
    { email: input.email.toLowerCase(), name: input.name, emailVerified: true, role: input.role ?? 'user' },
    { method: 'admin' },
  )
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  })
  return user
}

/** Seeds the first platform admin from ADMIN_EMAIL / ADMIN_PASSWORD when no user exists. */
export async function seedAdmin() {
  const count = (db().prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n
  if (count > 0) return
  if (!env.adminEmail || !env.adminPassword) {
    console.warn('[auth] no users yet — set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin')
    return
  }
  await createUserWithPassword({ email: env.adminEmail, name: env.adminEmail.split('@')[0], password: env.adminPassword, role: 'admin' })
  console.log(`[auth] created platform admin ${env.adminEmail}`)
}

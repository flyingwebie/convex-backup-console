import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from './db.server'
import { env } from './env.server'

function authOptions() {
  return {
    appName: 'Convex Backup Console',
    database: db(),
    secret: env.authSecret,
    baseURL: env.publicUrl,
    trustedOrigins: [env.publicUrl],
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
    plugins: [twoFactor({ issuer: 'Convex Backup Console' }), tanstackStartCookies()],
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

/** Seeds the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when no user exists (sign-up is disabled). */
export async function seedAdmin() {
  const count = (db().prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n
  if (count > 0) return
  if (!env.adminEmail || !env.adminPassword) {
    console.warn('[auth] no users yet — set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin')
    return
  }
  const ctx = await auth().$context
  const user = await ctx.internalAdapter.createUser({
    email: env.adminEmail.toLowerCase(),
    name: env.adminEmail.split('@')[0],
    emailVerified: true,
  }, { method: 'admin' })
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(env.adminPassword),
  })
  console.log(`[auth] created admin ${env.adminEmail}`)
}

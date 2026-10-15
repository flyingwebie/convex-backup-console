import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { createUserWithPassword, enabledProviders } from './auth.server'
import { ensureBooted } from './boot.server'
import { audit, db } from './db.server'
import { getSmtp } from './mail.server'
import { checkSetupCode, finishClaim, finishOnboarding, hasUsers, onboardingState } from './setup.server'
import { requirePlatformAdmin, resolveContext } from './workspace.server'

const parse =
  <T extends z.ZodType>(schema: T) =>
  (data: unknown) =>
    schema.parse(data) as z.infer<T>

export type SetupStep = 'account' | 'signin' | 'security' | 'workspace' | 'team' | 'done'

/** Where the first-run wizard is. Public: before the console is claimed nobody is signed in. */
export const getSetup = createServerFn({ method: 'GET' }).handler(async () => {
  await ensureBooted()
  const state = onboardingState()
  const base = { providers: enabledProviders(), smtp: Boolean(getSmtp()), timezones: ['UTC', ...Intl.supportedValuesOf('timeZone').filter((t) => t !== 'UTC')] }
  if (state === 'claim') return { ...base, step: 'account' as SetupStep, workspace: null }
  if (state === 'done') return { ...base, step: 'done' as SetupStep, workspace: null }
  const ctx = await resolveContext()
  const step: SetupStep = !ctx
    ? 'signin'
    : !ctx.user.isPlatformAdmin
      ? 'done'
      : !ctx.user.twoFactorEnabled || !ctx.user.sessionFactor
        ? 'security'
        : ctx.workspaces.length === 0
          ? 'workspace'
          : 'team'
  return { ...base, step, workspace: ctx?.active ? { id: ctx.active.id, name: ctx.active.name, logo: ctx.active.logo } : null }
})

let claiming = false

/** Creates the first platform admin. Needs the setup code from the server logs. */
export const claimConsole = createServerFn({ method: 'POST' })
  .validator(
    parse(
      z.object({
        code: z.string().trim().min(1, 'Enter the setup code'),
        name: z.string().trim().min(1).max(80),
        email: z.email().transform((e) => e.toLowerCase()),
        password: z.string().min(12, 'Use at least 12 characters').max(128),
      }),
    ),
  )
  .handler(async ({ data }) => {
    await ensureBooted()
    if (claiming || hasUsers()) throw new Error('This console has already been set up — sign in instead')
    checkSetupCode(data.code)
    claiming = true
    try {
      await createUserWithPassword({ email: data.email, name: data.name, password: data.password, role: 'admin' })
      finishClaim()
      audit(null, data.email, 'platform.claimed')
    } finally {
      claiming = false
    }
    return { email: data.email }
  })

export const completeOnboarding = createServerFn({ method: 'POST' }).handler(async () => {
  const ctx = await requirePlatformAdmin()
  finishOnboarding()
  audit(ctx.active?.id ?? null, ctx.user.email, 'platform.onboarding_completed', {
    workspaces: ctx.workspaces.length,
    invitations: (db().prepare("SELECT COUNT(*) AS n FROM invitation WHERE status = 'pending'").get() as { n: number }).n,
  })
})

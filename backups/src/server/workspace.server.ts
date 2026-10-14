import { getRequest } from '@tanstack/react-start/server'
import { can, type Action, type Role } from '~/lib/permissions'
import { auth } from './auth.server'
import { ensureBooted } from './boot.server'
import { db, getSetting, setSetting } from './db.server'
import { factorsOf, sessionFactor } from './security.server'

export type WorkspaceSettings = {
  workspace_id: string
  description: string | null
  timezone: string
  default_keep_last: number | null
  default_keep_daily: number | null
  default_keep_weekly: number | null
  default_keep_monthly: number | null
  default_encrypt: number
  default_include_storage: number
  stale_hours: number
  trash_days: number
  purge_backups: number
  age_recipient: string | null
  age_identity_enc: string | null
  deleted_at: number | null
}

export function workspaceSettings(workspaceId: string): WorkspaceSettings {
  db().prepare('INSERT OR IGNORE INTO workspace_settings (workspace_id) VALUES (?)').run(workspaceId)
  return db().prepare('SELECT * FROM workspace_settings WHERE workspace_id = ?').get(workspaceId) as WorkspaceSettings
}

export type Membership = { id: string; name: string; slug: string; logo: string | null; role: Role }

/** Workspaces the user belongs to, excluding ones in the trash. */
export function membershipsOf(userId: string): Membership[] {
  return db()
    .prepare(
      `SELECT o.id, o.name, o.slug, o.logo, m.role FROM member m JOIN organization o ON o.id = m.organizationId
       LEFT JOIN workspace_settings s ON s.workspace_id = o.id
       WHERE m.userId = ? AND s.deleted_at IS NULL ORDER BY o.name`,
    )
    .all(userId) as Membership[]
}

/** Session user + active workspace (falls back to the first membership and persists it). */
export async function resolveContext() {
  await ensureBooted()
  const headers = getRequest().headers
  const session = await auth().api.getSession({ headers })
  if (!session) return null
  const user = session.user as typeof session.user & { role?: string | null }
  const workspaces = membershipsOf(user.id)
  let active = workspaces.find((w) => w.id === session.session.activeOrganizationId) ?? workspaces[0] ?? null
  if (active && active.id !== session.session.activeOrganizationId) {
    await auth().api.setActiveOrganization({ headers, body: { organizationId: active.id } }).catch(() => {})
  }
  const factors = factorsOf(user.id)
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      // Account has a second factor (TOTP or passkey) and this session used it.
      twoFactorEnabled: factors.any,
      hasTotp: factors.totp,
      passkeys: factors.passkeys,
      sessionFactor: sessionFactor(session.session.token),
      isPlatformAdmin: user.role === 'admin',
    },
    sessionToken: session.session.token,
    workspaces,
    active,
  }
}

export type Ctx = NonNullable<Awaited<ReturnType<typeof resolveContext>>>

/** Throws unless the user is signed in with 2FA, has an active workspace and its role allows `action`. */
export async function requireWorkspace(action: Action) {
  const ctx = await resolveContext()
  if (!ctx) throw new Error('Unauthorized')
  if (!ctx.user.twoFactorEnabled) throw new Error('Two-factor authentication must be enabled first')
  if (!ctx.user.sessionFactor) throw new Error('Verify with your authenticator app or passkey first')
  if (!ctx.active) throw new Error('You are not a member of any workspace yet')
  if (!can(ctx.active.role, action)) throw new Error(`Your role (${ctx.active.role}) cannot do this`)
  return { ...ctx, ws: ctx.active }
}

export async function requirePlatformAdmin() {
  const ctx = await resolveContext()
  if (!ctx?.user.twoFactorEnabled || !ctx.user.sessionFactor || !ctx.user.isPlatformAdmin) throw new Error('Platform admins only')
  return ctx
}

/**
 * First boot after upgrading from single-tenant: puts all existing data into a "Default" workspace,
 * makes existing users its owners, and promotes the first user to platform admin if none exists.
 */
export async function bootstrapWorkspaces() {
  const users = db().prepare('SELECT id, role FROM user ORDER BY createdAt').all() as { id: string; role: string | null }[]
  if (users.length === 0) return
  if (!users.some((u) => u.role === 'admin')) db().prepare("UPDATE user SET role = 'admin' WHERE id = ?").run(users[0].id)

  const legacy = (['instances', 'destinations', 'jobs', 'channels', 'runs', 'restores'] as const).some(
    (t) => (db().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE workspace_id IS NULL`).get() as { n: number }).n > 0,
  )
  const orgs = (db().prepare('SELECT COUNT(*) AS n FROM organization').get() as { n: number }).n
  if (orgs > 0 && !legacy) return

  let workspaceId = (db().prepare('SELECT id FROM organization ORDER BY createdAt LIMIT 1').get() as { id: string } | undefined)?.id
  if (!workspaceId) {
    const owner = users.find((u) => u.role === 'admin') ?? users[0]
    const org = await auth().api.createOrganization({ body: { name: 'Default', slug: 'default', userId: owner.id } })
    workspaceId = org!.id
    for (const u of users) {
      if (u.id === owner.id) continue
      await auth().api.addMember({ body: { userId: u.id, role: 'owner', organizationId: workspaceId } })
    }
    console.log('[workspaces] created "Default" workspace for existing data')
  }
  db().transaction(() => {
    for (const t of ['instances', 'destinations', 'jobs', 'channels', 'runs', 'restores', 'audit']) {
      db().prepare(`UPDATE ${t} SET workspace_id = ? WHERE workspace_id IS NULL`).run(workspaceId)
    }
    workspaceSettings(workspaceId)
    // Single-tenant versions kept the age key globally.
    const recipient = getSetting('age_recipient')
    if (recipient) {
      db()
        .prepare('UPDATE workspace_settings SET age_recipient = ?, age_identity_enc = ? WHERE workspace_id = ? AND age_recipient IS NULL')
        .run(recipient, getSetting('age_identity_enc'), workspaceId)
      setSetting('age_recipient', '')
      setSetting('age_identity_enc', '')
    }
  })()
}

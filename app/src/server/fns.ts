import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { can, ROLES } from '~/lib/permissions'
import { THEMES } from '~/lib/themes'
import { auth, createUserWithPassword, enabledProviders } from './auth.server'
import { isInstanceBusy, startJob } from './backup.server'
import { ensureBooted } from './boot.server'
import { ConvexAdmin, parseDeployKey, resolveCloudUrl } from './convex.server'
import { decrypt, encrypt } from './crypto.server'
import { audit, db } from './db.server'
import { env } from './env.server'
import { createEncryptionKey, encryptionIdentity, encryptionRecipient } from './encryption.server'
import { getSmtp, invitationUrl, saveSmtp, sendMail } from './mail.server'
import { send, type ChannelConfig } from './notify.server'
import { sendDigest } from './digest.server'
import { resolveRecipients, roleLabel, routeFor, sendSecurityEmail, sendWorkspaceEmail, smtpFor } from './email/service.server'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { decryptStream } from './encryption.server'
import { inspectZip, type Manifest, type ScrubRule } from './zip.server'
import { deleteRun as deleteRunNow, purgeItem, purgeWorkspace, restoreItem, restoreWorkspace, softDelete, softDeleteWorkspace, workspaceGraceDays } from './purge.server'
import { isRestoring, startRestore } from './restore.server'
import { nextRun, syncSchedules } from './scheduler.server'
import { openDestination, type DestinationRow } from './storage.server'
import { requirePlatformAdmin, requireWorkspace, resolveContext, workspaceSettings } from './workspace.server'
import { onboardingState } from './setup.server'
import { resetSecondFactors, stepUpWithTotp, upgradeAfterPasskeyRegistration } from './security.server'

const parse =
  <T extends z.ZodType>(schema: T) =>
  (data: unknown) =>
    schema.parse(data) as z.infer<T>
const byId = z.object({ id: z.string() })
const headers = () => getRequest().headers

// ── Session / workspace context ──────────────────────────────

/** Minimal session info for auth pages. */
export const getUser = createServerFn({ method: 'GET' }).handler(async () => {
  const ctx = await resolveContext()
  return ctx
    ? {
        email: ctx.user.email,
        onboarding: ctx.user.isPlatformAdmin && onboardingState() === 'pending',
        twoFactorEnabled: ctx.user.twoFactorEnabled,
        hasTotp: ctx.user.hasTotp,
        passkeys: ctx.user.passkeys,
        sessionFactor: ctx.user.sessionFactor,
        hasPassword: Boolean(db().prepare("SELECT 1 FROM account WHERE userId = ? AND providerId = 'credential'").get(ctx.user.id)),
      }
    : null
})

/** Public: which sign-in methods are configured (drives the login page). */
export const getAuthProviders = createServerFn({ method: 'GET' }).handler(async () => {
  await ensureBooted()
  return { providers: enabledProviders(), needsSetup: onboardingState() === 'claim' }
})

/** Upgrades a social sign-in session with a TOTP code. */
export const stepUp = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })))
  .handler(async ({ data }) => {
    const ctx = await resolveContext()
    if (!ctx) throw new Error('Unauthorized')
    await stepUpWithTotp(ctx.user.id, ctx.sessionToken, data.code)
    audit(null, ctx.user.email, 'auth.step_up', { factor: 'totp' })
  })

/** Called right after enrolling TOTP or a passkey on /security, so the enrolling session counts as verified. */
export const confirmEnrolment = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ method: z.enum(['totp', 'passkey']), code: z.string().optional() })))
  .handler(async ({ data }) => {
    const ctx = await resolveContext()
    if (!ctx) throw new Error('Unauthorized')
    if (data.method === 'totp') await stepUpWithTotp(ctx.user.id, ctx.sessionToken, data.code ?? '')
    else upgradeAfterPasskeyRegistration(ctx.user.id, ctx.sessionToken)
    audit(null, ctx.user.email, 'auth.second_factor_enrolled', { method: data.method })
  })

/** Everything the app shell needs: user, workspaces, the active one and its settings. */
export const getAppContext = createServerFn({ method: 'GET' }).handler(async () => {
  const ctx = await resolveContext()
  if (!ctx) return null
  const settings = ctx.active ? workspaceSettings(ctx.active.id) : null
  return {
    user: ctx.user,
    onboarding: ctx.user.isPlatformAdmin && onboardingState() === 'pending',
    tourSeen: Boolean(db().prepare('SELECT tour_seen_at FROM user_prefs WHERE user_id = ? AND tour_seen_at IS NOT NULL').get(ctx.user.id)),
    workspaces: ctx.workspaces,
    active: ctx.active,
    settings: settings && {
      timezone: settings.timezone,
      stale_hours: settings.stale_hours,
      trash_days: settings.trash_days,
      theme: settings.theme,
      encryption: Boolean(settings.age_recipient),
    },
  }
})

/** The product tour starts by itself until the user finishes or closes it once. */
export const markTourSeen = createServerFn({ method: 'POST' }).handler(async () => {
  const ctx = await resolveContext()
  if (!ctx) throw new Error('Unauthorized')
  db()
    .prepare('INSERT INTO user_prefs (user_id, tour_seen_at) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET tour_seen_at = excluded.tour_seen_at')
    .run(ctx.user.id, Date.now())
})

export const switchWorkspace = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const ctx = await resolveContext()
    if (!ctx?.workspaces.some((w) => w.id === data.id)) throw new Error('Not a member of that workspace')
    await auth().api.setActiveOrganization({ headers: headers(), body: { organizationId: data.id } })
  })

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes')
  .max(48)

export const createWorkspace = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ name: z.string().trim().min(1).max(60), slug, timezone: z.string().optional() })))
  .handler(async ({ data }) => {
    const ctx = await requirePlatformAdmin()
    const org = await auth().api.createOrganization({ headers: headers(), body: { name: data.name, slug: data.slug } })
    if (!org) throw new Error('Could not create workspace')
    workspaceSettings(org.id)
    if (data.timezone && (data.timezone === 'UTC' || TIMEZONES.includes(data.timezone))) {
      db().prepare('UPDATE workspace_settings SET timezone = ? WHERE workspace_id = ?').run(data.timezone, org.id)
    }
    await auth().api.setActiveOrganization({ headers: headers(), body: { organizationId: org.id } })
    audit(org.id, ctx.user.email, 'workspace.created', { name: data.name, slug: data.slug })
    return { id: org.id }
  })

// ── Shared row shapes ────────────────────────────────────────

type CopyRow = { destination_id: string; status: string; error: string | null; key: string; deleted: number; locked_until: number | null }

function listRuns(ws: string, limit: number, jobId?: string, range: { from?: number; to?: number } = {}) {
  const where = [jobId && 'AND r.job_id = ?', range.from != null && 'AND r.started_at >= ?', range.to != null && 'AND r.started_at < ?'].filter(Boolean).join(' ')
  const params = [jobId, range.from, range.to].filter((p) => p != null)
  const rows = db()
    .prepare(
      `SELECT r.*, j.name AS job_name, i.name AS instance_name,
         (SELECT json_group_array(json_object('destination_id', c.destination_id, 'status', c.status, 'error', c.error, 'key', c.object_key, 'deleted', c.deleted_at IS NOT NULL, 'locked_until', c.locked_until))
          FROM run_copies c WHERE c.run_id = r.id) AS copies
       FROM runs r LEFT JOIN jobs j ON j.id = r.job_id LEFT JOIN instances i ON i.id = r.instance_id
       WHERE r.workspace_id = ? ${where}
       ORDER BY r.started_at DESC LIMIT ${Number(limit)}`,
    )
    .all(ws, ...params) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: String(r.id),
    job_id: (r.job_id as string | null) ?? null,
    job_name: (r.job_name as string | null) ?? 'Deleted job',
    instance_id: (r.instance_id as string | null) ?? null,
    instance_name: (r.instance_name as string | null) ?? 'Deleted instance',
    trigger: String(r.trigger),
    status: String(r.status) as 'running' | 'ok' | 'partial' | 'failed',
    started_at: Number(r.started_at),
    finished_at: r.finished_at == null ? null : Number(r.finished_at),
    bytes: r.bytes == null ? null : Number(r.bytes),
    encrypted: Boolean(r.encrypted),
    has_manifest: r.manifest != null,
    sha256: (r.sha256 as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    copies: (JSON.parse(String(r.copies)) as CopyRow[]).map((c) => ({ ...c, deleted: Boolean(c.deleted) })),
  }))
}
export type RunView = ReturnType<typeof listRuns>[number]

function listInstances(ws: string) {
  return (
    db()
      .prepare('SELECT id, name, url, kind, deployment_name, deployment_type, created_at FROM instances WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name')
      .all(ws) as {
      id: string
      name: string
      url: string
      kind: 'self_hosted' | 'cloud'
      deployment_name: string | null
      deployment_type: string | null
      created_at: number
    }[]
  ).map((i) => {
    const last = db()
      .prepare("SELECT status FROM runs WHERE instance_id = ? AND status != 'running' ORDER BY started_at DESC LIMIT 1")
      .get(i.id) as { status: string } | undefined
    const lastOk = db()
      .prepare("SELECT started_at FROM runs WHERE instance_id = ? AND status IN ('ok', 'partial') ORDER BY started_at DESC LIMIT 1")
      .get(i.id) as { started_at: number } | undefined
    return { ...i, busy: isInstanceBusy(i.id), restoring: isRestoring(i.id), last_status: last?.status ?? null, last_ok_at: lastOk?.started_at ?? null }
  })
}

/** $/GB-month for the cost estimate: explicit setting, else a guess from the endpoint (list prices, Oct 2026). */
function priceFor(kind: string, cfg: { pricePerGbMonth?: number; endpoint?: string }) {
  if (cfg.pricePerGbMonth != null) return cfg.pricePerGbMonth
  if (kind === 'local') return 0
  const e = cfg.endpoint ?? ''
  if (e.includes('r2.cloudflarestorage.com')) return 0.015
  if (e.includes('backblazeb2.com')) return 0.006
  if (e.includes('wasabisys.com')) return 0.0069
  if (!e) return 0.023 // AWS S3 Standard
  return 0
}

function describeDestination(d: DestinationRow) {
  const cfg = JSON.parse(d.config) as Record<string, string | boolean | undefined>
  return d.kind === 'local' ? String(cfg.root) : `${cfg.endpoint || 'AWS S3'} · ${cfg.bucket}${cfg.prefix ? '/' + cfg.prefix : ''}`
}

function listDestinations(ws: string) {
  return (db().prepare('SELECT * FROM destinations WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name').all(ws) as DestinationRow[]).map((d) => {
    const cfg = JSON.parse(d.config) as { objectLock?: { mode: string; days: number }; pricePerGbMonth?: number; endpoint?: string }
    return { id: d.id, name: d.name, kind: d.kind, summary: describeDestination(d), objectLock: cfg.objectLock ?? null, price: priceFor(d.kind, cfg) }
  })
}

function listJobs(ws: string) {
  const tz = workspaceSettings(ws).timezone
  return (
    db()
      .prepare(
        `SELECT j.*, GROUP_CONCAT(jd.destination_id) AS destination_ids FROM jobs j
         LEFT JOIN job_destinations jd ON jd.job_id = j.id
         WHERE j.workspace_id = ? AND j.deleted_at IS NULL GROUP BY j.id ORDER BY j.name`,
      )
      .all(ws) as {
      id: string
      name: string
      instance_id: string
      include_storage: number
      encrypt: number
      cron: string | null
      keep_last: number | null
      keep_daily: number | null
      keep_weekly: number | null
      keep_monthly: number | null
      enabled: number
      destination_ids: string | null
    }[]
  ).map((j) => ({
    ...j,
    include_storage: Boolean(j.include_storage),
    encrypt: Boolean(j.encrypt),
    enabled: Boolean(j.enabled),
    destination_ids: j.destination_ids ? j.destination_ids.split(',') : [],
    next_run: j.enabled && j.cron ? nextRun(j.cron, tz) : null,
  }))
}
export type JobView = ReturnType<typeof listJobs>[number]

function listRestores(ws: string, limit: number) {
  return db()
    .prepare(
      `SELECT id, run_id, object_key, target_name, mode, actor, status, confirm_message, rows_written, error, started_at, finished_at, tables, scrubbed
       FROM restores WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ${Number(limit)}`,
    )
    .all(ws) as {
    tables: string | null
    scrubbed: number
    id: string
    run_id: string
    object_key: string
    target_name: string
    mode: string
    actor: string
    status: 'running' | 'ok' | 'failed'
    confirm_message: string | null
    rows_written: number | null
    error: string | null
    started_at: number
    finished_at: number | null
  }[]
}

// ── Page loaders ─────────────────────────────────────────────

export const getOverview = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  const since = Date.now() - 7 * 86_400_000
  const stats = db()
    .prepare(
      `SELECT COUNT(*) AS total, SUM(status = 'ok') AS ok, SUM(status = 'partial') AS partial, SUM(status = 'failed') AS failed,
              COALESCE(SUM(CASE WHEN status IN ('ok','partial') THEN bytes END), 0) AS bytes
       FROM runs WHERE workspace_id = ? AND started_at >= ?`,
    )
    .get(ws.id, since) as { total: number; ok: number | null; partial: number | null; failed: number | null; bytes: number }
  return {
    instances: listInstances(ws.id),
    jobs: listJobs(ws.id),
    destinations: listDestinations(ws.id),
    runs: listRuns(ws.id, 8),
    stats: { total: stats.total, ok: stats.ok ?? 0, partial: stats.partial ?? 0, failed: stats.failed ?? 0, bytes: stats.bytes },
    encryption: Boolean(encryptionRecipient(ws.id)),
    channels: (db().prepare('SELECT COUNT(*) AS n FROM channels WHERE workspace_id = ?').get(ws.id) as { n: number }).n,
  }
})

export const getInstances = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  return { instances: listInstances(ws.id), jobs: listJobs(ws.id) }
})

export const getDestinations = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  return { destinations: listDestinations(ws.id), jobs: listJobs(ws.id) }
})

export const getJobs = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  const s = workspaceSettings(ws.id)
  return {
    jobs: listJobs(ws.id),
    instances: listInstances(ws.id),
    destinations: listDestinations(ws.id),
    encryption: Boolean(s.age_recipient),
    timezone: s.timezone,
    defaults: {
      keepLast: s.default_keep_last,
      keepDaily: s.default_keep_daily,
      keepWeekly: s.default_keep_weekly,
      keepMonthly: s.default_keep_monthly,
      encrypt: Boolean(s.default_encrypt),
      includeStorage: Boolean(s.default_include_storage),
    },
  }
})

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()

export const getRuns = createServerFn({ method: 'GET' })
  .validator(parse(z.object({ jobId: z.string().optional(), from: isoDay, to: isoDay })))
  .handler(async ({ data }) => {
    const { ws } = await requireWorkspace('view')
    // Dates are the browser's local days. Widen by a day each side to cover any timezone; the page
    // trims to the exact local range.
    const range = {
      from: data.from ? Date.parse(`${data.from}T00:00:00Z`) - 86_400_000 : undefined,
      to: data.to ? Date.parse(`${data.to}T00:00:00Z`) + 2 * 86_400_000 : undefined,
    }
    const filtered = data.from || data.to
    return {
      runs: listRuns(ws.id, filtered ? 1000 : 200, data.jobId, range),
      instances: listInstances(ws.id),
      destinations: listDestinations(ws.id),
      restores: listRestores(ws.id, 50),
    }
  })

export const getAudit = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  return {
    events: db().prepare('SELECT id, at, actor, action, detail FROM audit WHERE workspace_id = ? ORDER BY id DESC LIMIT 300').all(ws.id) as {
      id: number
      at: number
      actor: string
      action: string
      detail: string | null
    }[],
  }
})

// ── Instances ────────────────────────────────────────────────

const name = z.string().trim().min(1).max(80)
const url = z.url().transform((u) => u.replace(/\/+$/, ''))
const instanceInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self_hosted'), name, url, adminKey: z.string().trim().min(10) }),
  // Cloud: the URL is looked up from the deploy key unless given (e.g. a custom domain).
  z.object({ kind: z.literal('cloud'), name, deployKey: z.string().trim().min(10), url: url.optional().or(z.literal('').transform(() => undefined)) }),
])

async function probe(url: string, adminKey: string) {
  const convex = new ConvexAdmin(url, adminKey)
  const version = await convex.version()
  await convex.latestExport() // proves the key works and may read backups
  return version
}

/** Validates credentials against the deployment and returns what to store. */
async function connect(input: z.infer<typeof instanceInput>) {
  if (input.kind === 'self_hosted') {
    return { kind: input.kind, url: input.url, key: input.adminKey, deploymentName: null, deploymentType: null, version: await probe(input.url, input.adminKey) }
  }
  const info = parseDeployKey(input.deployKey)
  const resolved = input.url ?? (await resolveCloudUrl(input.deployKey))
  const version = await probe(resolved, input.deployKey).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(/40[13]/.test(msg) ? `The deploy key was rejected by ${resolved} — it may lack backup permissions or be revoked` : msg)
  })
  return { kind: input.kind, url: resolved, key: input.deployKey, deploymentName: info.deploymentName, deploymentType: info.type, version }
}

function uniqueName(err: unknown, what: string): never {
  if (String(err).includes('UNIQUE')) throw new Error(`A ${what} with that name already exists in this workspace`)
  throw err
}

export const addInstance = createServerFn({ method: 'POST' })
  .validator(parse(instanceInput))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    const c = await connect(data)
    const id = randomUUID()
    try {
      db()
        .prepare(
          `INSERT INTO instances (id, workspace_id, name, url, admin_key_enc, kind, deployment_name, deployment_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, ws.id, data.name, c.url, encrypt(c.key), c.kind, c.deploymentName, c.deploymentType, Date.now())
    } catch (err) {
      uniqueName(err, 'instance')
    }
    audit(ws.id, user.email, 'instance.created', { id, name: data.name, kind: c.kind, url: c.url, deployment: c.deploymentName })
    return { id, version: c.version, url: c.url }
  })

export const updateInstance = createServerFn({ method: 'POST' })
  .validator(
    parse(
      z.object({
        id: z.string(),
        name,
        // Self-hosted: URL (+ optional new admin key). Cloud: optional new deploy key and/or URL override.
        url: z.string().trim().optional(),
        key: z.string().trim().optional(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    const row = db().prepare('SELECT kind, url, admin_key_enc FROM instances WHERE id = ? AND workspace_id = ?').get(data.id, ws.id) as
      | { kind: 'self_hosted' | 'cloud'; url: string; admin_key_enc: string }
      | undefined
    if (!row) throw new Error('Instance not found')
    const key = data.key || decrypt(row.admin_key_enc)
    const c = await connect(
      row.kind === 'cloud'
        ? { kind: 'cloud', name: data.name, deployKey: key, url: data.url ? url.parse(data.url) : data.key ? undefined : row.url }
        : { kind: 'self_hosted', name: data.name, url: url.parse(data.url || row.url), adminKey: key },
    )
    try {
      db()
        .prepare('UPDATE instances SET name = ?, url = ?, admin_key_enc = ?, deployment_name = ?, deployment_type = ? WHERE id = ?')
        .run(data.name, c.url, encrypt(c.key), c.deploymentName, c.deploymentType, data.id)
    } catch (err) {
      uniqueName(err, 'instance')
    }
    audit(ws.id, user.email, 'instance.updated', { id: data.id, name: data.name, url: c.url, keyChanged: Boolean(data.key) })
    return { version: c.version }
  })

export const testInstance = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws } = await requireWorkspace('run')
    const row = db().prepare('SELECT url, admin_key_enc FROM instances WHERE id = ? AND workspace_id = ?').get(data.id, ws.id) as
      | { url: string; admin_key_enc: string }
      | undefined
    if (!row) throw new Error('Instance not found')
    return { version: await probe(row.url, decrypt(row.admin_key_enc)) }
  })

export const deleteInstance = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    await softDelete(ws.id, 'instance', data.id, user.email)
  })

// ── Destinations ─────────────────────────────────────────────

const destinationInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('s3'),
    name: z.string().trim().min(1).max(80),
    endpoint: z.string().trim().optional(),
    region: z.string().trim().default('auto'),
    bucket: z.string().trim().min(1),
    prefix: z.string().trim().optional(),
    forcePathStyle: z.boolean().default(false),
    accessKeyId: z.string().trim().min(1),
    secretAccessKey: z.string().trim().min(1),
    objectLock: z.object({ mode: z.enum(['GOVERNANCE', 'COMPLIANCE']), days: z.number().int().min(1).max(3650) }).nullable().default(null),
    pricePerGbMonth: z.number().min(0).max(10).nullable().default(null),
  }),
  z.object({
    kind: z.literal('local'),
    name: z.string().trim().min(1).max(80),
    root: z.string().trim().startsWith('/'),
    pricePerGbMonth: z.number().min(0).max(10).nullable().default(null),
  }),
])

export const addDestination = createServerFn({ method: 'POST' })
  .validator(parse(destinationInput))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    const id = randomUUID()
    const row: DestinationRow =
      data.kind === 's3'
        ? {
            id,
            name: data.name,
            kind: 's3',
            config: JSON.stringify({
              endpoint: data.endpoint || undefined,
              region: data.region || 'auto',
              bucket: data.bucket,
              prefix: data.prefix || undefined,
              forcePathStyle: data.forcePathStyle,
              accessKeyId: data.accessKeyId,
              objectLock: data.objectLock ?? undefined,
              pricePerGbMonth: data.pricePerGbMonth ?? undefined,
            }),
            secret_enc: encrypt(data.secretAccessKey),
          }
        : { id, name: data.name, kind: 'local', config: JSON.stringify({ root: data.root, pricePerGbMonth: data.pricePerGbMonth ?? undefined }), secret_enc: null }
    await openDestination(row).test()
    try {
      db()
        .prepare('INSERT INTO destinations (id, workspace_id, name, kind, config, secret_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(row.id, ws.id, row.name, row.kind, row.config, row.secret_enc, Date.now())
    } catch (err) {
      uniqueName(err, 'destination')
    }
    audit(ws.id, user.email, 'destination.created', { id, name: data.name, kind: data.kind })
    return { id }
  })

export const testDestination = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws } = await requireWorkspace('run')
    const row = db().prepare('SELECT * FROM destinations WHERE id = ? AND workspace_id = ?').get(data.id, ws.id) as DestinationRow | undefined
    if (!row) throw new Error('Destination not found')
    await openDestination(row).test()
    return { ok: true }
  })

export const deleteDestination = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    await softDelete(ws.id, 'destination', data.id, user.email)
  })

// ── Jobs ─────────────────────────────────────────────────────

const keep = z.number().int().positive().nullable().default(null)
const jobInput = z.object({
  name: z.string().trim().min(1).max(80),
  instanceId: z.string(),
  destinationIds: z.array(z.string()).min(1, 'Pick at least one destination'),
  includeStorage: z.boolean().default(true),
  encrypt: z.boolean().default(false),
  cron: z
    .string()
    .trim()
    .optional()
    .transform((c) => c || null)
    .refine((c) => c === null || nextRun(c) !== null, 'Invalid cron expression'),
  keepLast: keep,
  keepDaily: keep,
  keepWeekly: keep,
  keepMonthly: keep,
})

function writeJob(ws: string, id: string, data: z.infer<typeof jobInput>, isNew: boolean) {
  if (data.encrypt && !encryptionRecipient(ws)) throw new Error('Create an encryption key in Workspace settings first')
  const owned = (table: string, ids: string[]) =>
    ids.every((x) => db().prepare(`SELECT 1 FROM ${table} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).get(x, ws))
  if (!owned('instances', [data.instanceId]) || !owned('destinations', data.destinationIds)) throw new Error('Unknown instance or destination')
  db().transaction(() => {
    const values = [
      data.name,
      data.instanceId,
      data.includeStorage ? 1 : 0,
      data.encrypt ? 1 : 0,
      data.cron,
      data.keepLast,
      data.keepDaily,
      data.keepWeekly,
      data.keepMonthly,
    ]
    if (isNew) {
      db()
        .prepare(
          `INSERT INTO jobs (name, instance_id, include_storage, encrypt, cron, keep_last, keep_daily, keep_weekly, keep_monthly, id, workspace_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...values, id, ws, Date.now())
    } else {
      const res = db()
        .prepare(
          `UPDATE jobs SET name = ?, instance_id = ?, include_storage = ?, encrypt = ?, cron = ?, keep_last = ?, keep_daily = ?,
           keep_weekly = ?, keep_monthly = ? WHERE id = ? AND workspace_id = ?`,
        )
        .run(...values, id, ws)
      if (res.changes === 0) throw new Error('Job not found')
      db().prepare('DELETE FROM job_destinations WHERE job_id = ?').run(id)
    }
    const link = db().prepare('INSERT INTO job_destinations (job_id, destination_id) VALUES (?, ?)')
    for (const d of data.destinationIds) link.run(id, d)
  })()
  syncSchedules()
}

export const addJob = createServerFn({ method: 'POST' })
  .validator(parse(jobInput))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    const id = randomUUID()
    writeJob(ws.id, id, data, true)
    audit(ws.id, user.email, 'job.created', { id, ...data })
    return { id }
  })

export const updateJob = createServerFn({ method: 'POST' })
  .validator(parse(jobInput.extend({ id: z.string() })))
  .handler(async ({ data: { id, ...data } }) => {
    const { ws, user } = await requireWorkspace('manage')
    writeJob(ws.id, id, data, false)
    audit(ws.id, user.email, 'job.updated', { id, ...data })
  })

export const setJobEnabled = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ id: z.string(), enabled: z.boolean() })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    db().prepare('UPDATE jobs SET enabled = ? WHERE id = ? AND workspace_id = ?').run(data.enabled ? 1 : 0, data.id, ws.id)
    syncSchedules()
    audit(ws.id, user.email, data.enabled ? 'job.enabled' : 'job.disabled', { id: data.id })
  })

export const deleteJob = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    await softDelete(ws.id, 'job', data.id, user.email)
  })

export const runJobNow = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('run')
    if (!db().prepare('SELECT 1 FROM jobs WHERE id = ? AND workspace_id = ?').get(data.id, ws.id)) throw new Error('Job not found')
    const runId = startJob(data.id, `manual:${user.email}`)
    audit(ws.id, user.email, 'backup.started', { jobId: data.id, runId })
    return { runId }
  })

// ── Restore ──────────────────────────────────────────────────

export const restoreBackup = createServerFn({ method: 'POST' })
  .validator(
    parse(
      z.object({
        runId: z.string(),
        destinationId: z.string(),
        targetInstanceId: z.string(),
        mode: z.enum(['replaceAll', 'replace', 'append', 'requireEmpty']),
        confirm: z.string(),
        tables: z.array(z.string()).optional(),
        includeFiles: z.boolean().optional(),
        scrub: z.boolean().optional(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('restore')
    return { restoreId: startRestore({ ...data, workspaceId: ws.id, actor: user.email }) }
  })

// ── Notification channels ────────────────────────────────────

const channelConfig = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('webhook'), url: z.url() }),
  z.object({ kind: z.literal('discord'), url: z.url() }),
  z.object({ kind: z.literal('slack'), url: z.url() }),
  z.object({ kind: z.literal('telegram'), botToken: z.string().trim().min(10), chatId: z.string().trim().min(1) }),
])
const channelInput = z.object({
  name: z.string().trim().min(1).max(80),
  onFailure: z.boolean().default(true),
  onSuccess: z.boolean().default(false),
  config: channelConfig,
})

function describeTarget(cfg: ChannelConfig) {
  switch (cfg.kind) {
    case 'telegram':
      return `chat ${cfg.chatId}`
    default: {
      const u = new URL(cfg.url)
      return `${u.host}${u.pathname.length > 1 ? '/…' : ''}`
    }
  }
}

export const getChannels = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  return {
    channels: (
      db().prepare("SELECT id, name, kind, config_enc, on_failure, on_success FROM channels WHERE workspace_id = ? AND kind != 'email' ORDER BY name").all(ws.id) as {
        id: string
        name: string
        kind: ChannelConfig['kind']
        config_enc: string
        on_failure: number
        on_success: number
      }[]
    ).map(({ config_enc, ...c }) => ({
      ...c,
      on_failure: Boolean(c.on_failure),
      on_success: Boolean(c.on_success),
      target: describeTarget(JSON.parse(decrypt(config_enc)) as ChannelConfig),
    })),
  }
})

export const addChannel = createServerFn({ method: 'POST' })
  .validator(parse(channelInput))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    const id = randomUUID()
    db()
      .prepare('INSERT INTO channels (id, workspace_id, name, kind, config_enc, on_failure, on_success, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ws.id, data.name, data.config.kind, encrypt(JSON.stringify(data.config)), data.onFailure ? 1 : 0, data.onSuccess ? 1 : 0, Date.now())
    audit(ws.id, user.email, 'channel.created', { id, name: data.name, kind: data.config.kind })
    return { id }
  })

export const setChannelEvents = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ id: z.string(), onFailure: z.boolean(), onSuccess: z.boolean() })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    db()
      .prepare('UPDATE channels SET on_failure = ?, on_success = ? WHERE id = ? AND workspace_id = ?')
      .run(data.onFailure ? 1 : 0, data.onSuccess ? 1 : 0, data.id, ws.id)
    audit(ws.id, user.email, 'channel.updated', data)
  })

export const testChannel = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    const row = db().prepare('SELECT name, config_enc FROM channels WHERE id = ? AND workspace_id = ?').get(data.id, ws.id) as
      | { name: string; config_enc: string }
      | undefined
    if (!row) throw new Error('Channel not found')
    await send(JSON.parse(decrypt(row.config_enc)) as ChannelConfig, {
      type: 'test',
      status: 'ok',
      title: `[${ws.name}] Test notification from Convex Backup Console`,
      details: [`Channel: ${row.name}`, `Sent by ${user.email}`],
    })
  })

export const deleteChannel = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    db().prepare('DELETE FROM channels WHERE id = ? AND workspace_id = ?').run(data.id, ws.id)
    audit(ws.id, user.email, 'channel.deleted', data)
  })

// ── Workspace settings ───────────────────────────────────────

const TIMEZONES = Intl.supportedValuesOf('timeZone')

export const getWorkspace = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  const s = workspaceSettings(ws.id)
  return {
    workspace: ws,
    settings: {
      description: s.description,
      timezone: s.timezone,
      default_keep_last: s.default_keep_last,
      default_keep_daily: s.default_keep_daily,
      default_keep_weekly: s.default_keep_weekly,
      default_keep_monthly: s.default_keep_monthly,
      default_encrypt: Boolean(s.default_encrypt),
      default_include_storage: Boolean(s.default_include_storage),
      stale_hours: s.stale_hours,
      trash_days: s.trash_days,
      purge_remote: Boolean(s.purge_remote),
      purge_local: Boolean(s.purge_local),
      purge_remote_days: s.purge_remote_days,
      purge_local_days: s.purge_local_days,
      grace_days: workspaceGraceDays(ws.id),
      theme: s.theme,
      recipient: s.age_recipient,
      status_url: s.status_token ? `${env.publicUrl}/api/status/${s.status_token}` : null,
      digest: s.digest,
      digest_recipients: resolveRecipients(ws.id, 'digest').length,
      smtp: Boolean(smtpFor(ws.id)),
    },
    timezones: ['UTC', ...TIMEZONES.filter((t) => t !== 'UTC')],
  }
})

export const updateWorkspaceGeneral = createServerFn({ method: 'POST' })
  .validator(
    parse(
      z.object({
        name: z.string().trim().min(1).max(60),
        slug,
        description: z.string().trim().max(280).optional(),
        timezone: z.string().refine((t) => t === 'UTC' || TIMEZONES.includes(t), 'Unknown timezone'),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('settings')
    await auth().api.updateOrganization({ headers: headers(), body: { organizationId: ws.id, data: { name: data.name, slug: data.slug } } })
    db().prepare('UPDATE workspace_settings SET description = ?, timezone = ? WHERE workspace_id = ?').run(data.description || null, data.timezone, ws.id)
    syncSchedules()
    audit(ws.id, user.email, 'workspace.updated', data)
  })

const optKeep = z.number().int().positive().nullable()
export const updateWorkspaceDefaults = createServerFn({ method: 'POST' })
  .validator(
    parse(
      z.object({
        keepLast: optKeep,
        keepDaily: optKeep,
        keepWeekly: optKeep,
        keepMonthly: optKeep,
        encrypt: z.boolean(),
        includeStorage: z.boolean(),
        staleHours: z.number().int().min(1).max(24 * 31),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('settings')
    db()
      .prepare(
        `UPDATE workspace_settings SET default_keep_last = ?, default_keep_daily = ?, default_keep_weekly = ?, default_keep_monthly = ?,
         default_encrypt = ?, default_include_storage = ?, stale_hours = ? WHERE workspace_id = ?`,
      )
      .run(data.keepLast, data.keepDaily, data.keepWeekly, data.keepMonthly, data.encrypt ? 1 : 0, data.includeStorage ? 1 : 0, data.staleHours, ws.id)
    audit(ws.id, user.email, 'workspace.defaults_updated', data)
  })

const days = z.number().int().min(0).max(365)
export const updateDeletionPolicy = createServerFn({ method: 'POST' })
  .validator(
    parse(z.object({ trashDays: days, purgeRemote: z.boolean(), purgeLocal: z.boolean(), purgeRemoteDays: days, purgeLocalDays: days })),
  )
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('purge')
    db()
      .prepare(
        'UPDATE workspace_settings SET trash_days = ?, purge_remote = ?, purge_local = ?, purge_remote_days = ?, purge_local_days = ? WHERE workspace_id = ?',
      )
      .run(data.trashDays, data.purgeRemote ? 1 : 0, data.purgeLocal ? 1 : 0, data.purgeRemoteDays, data.purgeLocalDays, ws.id)
    audit(ws.id, user.email, 'workspace.deletion_policy_updated', data)
  })

export const updateWorkspaceTheme = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ theme: z.enum(THEMES) })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('settings')
    db().prepare('UPDATE workspace_settings SET theme = ? WHERE workspace_id = ?').run(data.theme, ws.id)
    audit(ws.id, user.email, 'workspace.theme_updated', data)
  })

export const rotateStatusToken = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ enabled: z.boolean() })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('settings')
    const token = data.enabled ? randomBytes(24).toString('base64url') : null
    db().prepare('UPDATE workspace_settings SET status_token = ? WHERE workspace_id = ?').run(token, ws.id)
    audit(ws.id, user.email, data.enabled ? 'workspace.status_url_rotated' : 'workspace.status_url_disabled')
  })

export const updateDigest = createServerFn({ method: 'POST' })
  .validator(
    parse(
      z.object({ digest: z.enum(['off', 'daily', 'weekly']) }),
    ),
  )
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('settings')
    db()
      .prepare('UPDATE workspace_settings SET digest = ?, digest_last_sent = NULL WHERE workspace_id = ?')
      .run(data.digest, ws.id)
    audit(ws.id, user.email, 'workspace.digest_updated', data)
  })

export const sendTestDigest = createServerFn({ method: 'POST' }).handler(async () => {
  const { ws, user } = await requireWorkspace('settings')
  const { sent } = await sendDigest(ws.id, Date.now() - 7 * 86_400_000)
  if (!sent) throw new Error('The digest could not be sent — check the audit log')
  audit(ws.id, user.email, 'workspace.digest_test_sent')
})

export const createEncryption = createServerFn({ method: 'POST' }).handler(async () => {
  const { ws, user } = await requireWorkspace('encryptionKey')
  const key = await createEncryptionKey(ws.id)
  audit(ws.id, user.email, 'encryption.key_created', { recipient: key.recipient })
  return key
})

export const revealEncryptionKey = createServerFn({ method: 'POST' }).handler(async () => {
  const { ws, user } = await requireWorkspace('encryptionKey')
  audit(ws.id, user.email, 'encryption.key_revealed')
  return { identity: encryptionIdentity(ws.id), recipient: encryptionRecipient(ws.id)! }
})

export const deleteWorkspace = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ confirm: z.string() })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('deleteWorkspace')
    if (data.confirm !== ws.name) throw new Error(`Type "${ws.name}" to confirm`)
    softDeleteWorkspace(ws.id, user.email)
    if (workspaceGraceDays(ws.id) === 0) await purgeWorkspace(ws.id, user.email)
  })

// ── Members & invitations ────────────────────────────────────

const role = z.enum(ROLES)

export const getMembers = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws, user } = await requireWorkspace('view')
  const members = db()
    .prepare(
      `SELECT m.id, m.role, m.createdAt AS created_at, u.id AS user_id, u.name, u.email, u.twoFactorEnabled AS two_factor
       FROM member m JOIN user u ON u.id = m.userId WHERE m.organizationId = ? ORDER BY u.email`,
    )
    .all(ws.id) as { id: string; role: string; created_at: string; user_id: string; name: string; email: string; two_factor: number }[]
  const invitations = can(ws.role, 'members')
    ? (db()
        .prepare(
          "SELECT id, email, role, status, expiresAt AS expires_at FROM invitation WHERE organizationId = ? AND status = 'pending' ORDER BY createdAt DESC",
        )
        .all(ws.id) as { id: string; email: string; role: string; status: string; expires_at: string }[]).map((i) => ({
        ...i,
        link: invitationUrl(i.id),
        expired: new Date(i.expires_at).getTime() < Date.now(),
      }))
    : []
  return { members: members.map((m) => ({ ...m, two_factor: Boolean(m.two_factor), you: m.user_id === user.id })), invitations, smtp: Boolean(smtpFor(ws.id)) }
})

export const inviteMember = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ email: z.email().transform((e) => e.toLowerCase()), role })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('members')
    const inv = await auth().api.createInvitation({
      headers: headers(),
      body: { email: data.email, role: data.role, organizationId: ws.id, resend: true },
    })
    audit(ws.id, user.email, 'member.invited', data)
    return { link: invitationUrl(inv.id), emailed: Boolean(smtpFor(ws.id)) && routeFor(ws.id, 'invitation').enabled }
  })

export const cancelInvite = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('members')
    await auth().api.cancelInvitation({ headers: headers(), body: { invitationId: data.id } })
    audit(ws.id, user.email, 'member.invitation_cancelled', data)
  })

function memberUser(memberId: string) {
  return db().prepare('SELECT u.email, u.name FROM member m JOIN user u ON u.id = m.userId WHERE m.id = ?').get(memberId) as { email: string; name: string }
}

function ownerCount(ws: string) {
  return (db().prepare("SELECT COUNT(*) AS n FROM member WHERE organizationId = ? AND role = 'owner'").get(ws) as { n: number }).n
}

export const changeMemberRole = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ memberId: z.string(), role })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('members')
    const m = db().prepare('SELECT role FROM member WHERE id = ? AND organizationId = ?').get(data.memberId, ws.id) as { role: string } | undefined
    if (!m) throw new Error('Member not found')
    if (m.role === 'owner' && data.role !== 'owner' && ownerCount(ws.id) <= 1) throw new Error('A workspace needs at least one owner')
    await auth().api.updateMemberRole({ headers: headers(), body: { memberId: data.memberId, role: data.role, organizationId: ws.id } })
    audit(ws.id, user.email, 'member.role_changed', data)
    if (m.role !== data.role) {
      const target = memberUser(data.memberId)
      void sendWorkspaceEmail(ws.id, 'member_role_changed', { member: { old_role: roleLabel(m.role), new_role: roleLabel(data.role) }, actor: { name: user.name } }, { to: target })
    }
  })

export const removeMember = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ memberId: z.string() })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('members')
    const m = db().prepare('SELECT role FROM member WHERE id = ? AND organizationId = ?').get(data.memberId, ws.id) as { role: string } | undefined
    if (!m) throw new Error('Member not found')
    if (m.role === 'owner' && ownerCount(ws.id) <= 1) throw new Error('A workspace needs at least one owner')
    const target = memberUser(data.memberId)
    await auth().api.removeMember({ headers: headers(), body: { memberIdOrEmail: data.memberId, organizationId: ws.id } })
    audit(ws.id, user.email, 'member.removed', data)
    void sendWorkspaceEmail(ws.id, 'member_removed', { actor: { name: user.name } }, { to: target })
  })

/** Public: details shown on the invitation page. */
export const getInvitation = createServerFn({ method: 'GET' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    await ensureBooted()
    const inv = db()
      .prepare(
        `SELECT i.id, i.email, i.role, i.status, i.expiresAt AS expires_at, o.name AS workspace, o.logo
         FROM invitation i JOIN organization o ON o.id = i.organizationId WHERE i.id = ?`,
      )
      .get(data.id) as { id: string; email: string; role: string; status: string; expires_at: string; workspace: string; logo: string | null } | undefined
    if (!inv) return null
    const userExists = Boolean(db().prepare('SELECT 1 FROM user WHERE email = ?').get(inv.email))
    return { ...inv, expired: new Date(inv.expires_at).getTime() < Date.now(), userExists }
  })

/** Public: creates the account for a pending invitation (sign-up is otherwise disabled). */
export const registerFromInvitation = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ id: z.string(), name: z.string().trim().min(1).max(80), password: z.string().min(12).max(128) })))
  .handler(async ({ data }) => {
    await ensureBooted()
    const inv = db().prepare("SELECT email, expiresAt AS expires_at FROM invitation WHERE id = ? AND status = 'pending'").get(data.id) as
      | { email: string; expires_at: string }
      | undefined
    if (!inv || new Date(inv.expires_at).getTime() < Date.now()) throw new Error('This invitation is no longer valid')
    if (db().prepare('SELECT 1 FROM user WHERE email = ?').get(inv.email)) throw new Error('An account already exists — sign in instead')
    await createUserWithPassword({ email: inv.email, name: data.name, password: data.password })
    return { email: inv.email }
  })

export const deleteRun = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ id: z.string(), confirm: z.literal('DELETE') })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('purge')
    await deleteRunNow(ws.id, data.id, user.email)
  })

// ── Trash ────────────────────────────────────────────────────

export const getTrash = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  const s = workspaceSettings(ws.id)
  const items = db()
    .prepare(
      `SELECT 'instance' AS kind, id, name, deleted_at, NULL AS parent FROM instances WHERE workspace_id = ? AND deleted_at IS NOT NULL
       UNION ALL
       SELECT 'job', j.id, j.name, j.deleted_at, CASE WHEN i.deleted_at = j.deleted_at THEN i.name END FROM jobs j
         JOIN instances i ON i.id = j.instance_id WHERE j.workspace_id = ? AND j.deleted_at IS NOT NULL
       UNION ALL
       SELECT 'destination', id, name, deleted_at, NULL FROM destinations WHERE workspace_id = ? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
    )
    .all(ws.id, ws.id, ws.id) as { kind: 'instance' | 'job' | 'destination'; id: string; name: string; deleted_at: number; parent: string | null }[]
  return {
    items: items.map((i) => ({ ...i, purge_at: i.deleted_at + s.trash_days * 86_400_000 })),
    trash_days: s.trash_days,
    purge_remote: Boolean(s.purge_remote),
    purge_local: Boolean(s.purge_local),
    purge_remote_days: s.purge_remote_days,
    purge_local_days: s.purge_local_days,
  }
})

const trashInput = z.object({ kind: z.enum(['instance', 'job', 'destination']), id: z.string() })

export const restoreFromTrash = createServerFn({ method: 'POST' })
  .validator(parse(trashInput))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('manage')
    restoreItem(ws.id, data.kind, data.id, user.email)
  })

export const purgeNow = createServerFn({ method: 'POST' })
  .validator(parse(trashInput))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('purge')
    await purgeItem(ws.id, data.kind, data.id, user.email)
  })

// ── Platform (platform admins) ───────────────────────────────

export const getPlatform = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePlatformAdmin()
  const workspaces = db()
    .prepare(
      `SELECT o.id, o.name, o.slug, o.logo, s.deleted_at, s.trash_days,
         (SELECT COUNT(*) FROM member m WHERE m.organizationId = o.id) AS members,
         (SELECT COUNT(*) FROM instances i WHERE i.workspace_id = o.id AND i.deleted_at IS NULL) AS instances
       FROM organization o LEFT JOIN workspace_settings s ON s.workspace_id = o.id ORDER BY o.name`,
    )
    .all() as { id: string; name: string; slug: string; logo: string | null; deleted_at: number | null; trash_days: number; members: number; instances: number }[]
  const withPurge = workspaces.map((w) => ({ ...w, purge_at: w.deleted_at ? w.deleted_at + workspaceGraceDays(w.id) * 86_400_000 : null }))
  const users = db()
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, (u.twoFactorEnabled OR EXISTS (SELECT 1 FROM passkey p WHERE p.userId = u.id)) AS two_factor, u.createdAt AS created_at,
         (SELECT COUNT(*) FROM member m WHERE m.userId = u.id) AS workspaces
       FROM user u ORDER BY u.email`,
    )
    .all() as { id: string; name: string; email: string; role: string | null; two_factor: number; created_at: string; workspaces: number }[]
  const smtp = getSmtp()
  return {
    workspaces: withPurge,
    users: users.map((u) => ({ ...u, isAdmin: u.role === 'admin', two_factor: Boolean(u.two_factor) })),
    smtp: smtp ? { ...smtp, pass: smtp.pass ? '••••••••' : '' } : null,
  }
})

export const resetUserSecondFactors = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ userId: z.string() })))
  .handler(async ({ data }) => {
    const ctx = await requirePlatformAdmin()
    if (data.userId === ctx.user.id) throw new Error("Use your own Account page to manage your factors")
    const target = db().prepare('SELECT email, name FROM user WHERE id = ?').get(data.userId) as { email: string; name: string } | undefined
    resetSecondFactors(data.userId)
    audit(null, ctx.user.email, 'platform.second_factors_reset', { userId: data.userId })
    if (target) void sendSecurityEmail('two_factor_reset', target, { actor: ctx.user.name || ctx.user.email })
  })

export const setPlatformAdmin = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ userId: z.string(), admin: z.boolean() })))
  .handler(async ({ data }) => {
    const ctx = await requirePlatformAdmin()
    if (data.userId === ctx.user.id && !data.admin) throw new Error("You can't remove your own platform admin role")
    db().prepare('UPDATE user SET role = ? WHERE id = ?').run(data.admin ? 'admin' : 'user', data.userId)
    audit(null, ctx.user.email, data.admin ? 'platform.admin_granted' : 'platform.admin_revoked', { userId: data.userId })
  })

const smtpInput = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  user: z.string().trim().optional(),
  pass: z.string().optional(),
  from: z.string().trim().min(3),
})

export const saveSmtpSettings = createServerFn({ method: 'POST' })
  .validator(parse(smtpInput.nullable()))
  .handler(async ({ data }) => {
    const ctx = await requirePlatformAdmin()
    if (data && data.pass === '••••••••') data.pass = getSmtp()?.pass
    saveSmtp(data)
    audit(null, ctx.user.email, data ? 'platform.smtp_updated' : 'platform.smtp_removed')
  })

export const testSmtp = createServerFn({ method: 'POST' }).handler(async () => {
  const ctx = await requirePlatformAdmin()
  await sendMail(ctx.user.email, 'Convex Backup Console: SMTP test', 'SMTP is configured correctly. Invitations will be emailed.')
})

export const restoreWorkspaceFromTrash = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const ctx = await requirePlatformAdmin()
    restoreWorkspace(data.id, ctx.user.email)
  })

export const purgeWorkspaceNow = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const ctx = await requirePlatformAdmin()
    await purgeWorkspace(data.id, ctx.user.email)
  })

// ── Backup contents ──────────────────────────────────────────

function runManifest(ws: string, runId: string) {
  const row = db().prepare('SELECT manifest, instance_id, started_at FROM runs WHERE id = ? AND workspace_id = ?').get(runId, ws) as
    | { manifest: string | null; instance_id: string | null; started_at: number }
    | undefined
  if (!row) throw new Error('Run not found')
  return row
}

/** A backup's manifest, compared with the previous backup of the same instance that has one. */
export const getRunContents = createServerFn({ method: 'GET' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws } = await requireWorkspace('view')
    const row = runManifest(ws.id, data.id)
    const previous = db()
      .prepare(
        `SELECT id, started_at, manifest FROM runs WHERE workspace_id = ? AND instance_id = ? AND started_at < ?
         AND manifest IS NOT NULL AND status IN ('ok', 'partial') ORDER BY started_at DESC LIMIT 1`,
      )
      .get(ws.id, row.instance_id, row.started_at) as { id: string; started_at: number; manifest: string } | undefined
    return {
      manifest: row.manifest ? (JSON.parse(row.manifest) as Manifest) : null,
      previous: previous ? { id: previous.id, started_at: previous.started_at, manifest: JSON.parse(previous.manifest) as Manifest } : null,
    }
  })

/** Builds the manifest for an older backup by downloading (and decrypting) one stored copy. */
export const inspectRun = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('download')
    runManifest(ws.id, data.id)
    const copy = db()
      .prepare("SELECT c.object_key, d.* FROM run_copies c JOIN destinations d ON d.id = c.destination_id WHERE c.run_id = ? AND c.status = 'ok' AND c.deleted_at IS NULL LIMIT 1")
      .get(data.id) as (DestinationRow & { object_key: string }) | undefined
    if (!copy) throw new Error('No stored copy left to inspect')
    const tmp = path.join(env.dataDir, 'tmp', `inspect-${data.id}.zip`)
    await fs.promises.mkdir(path.dirname(tmp), { recursive: true })
    try {
      const src = await openDestination(copy).get(copy.object_key)
      await pipeline(copy.object_key.endsWith('.age') ? await decryptStream(ws.id, src) : src, fs.createWriteStream(tmp))
      const manifest = await inspectZip(tmp)
      db().prepare('UPDATE runs SET manifest = ? WHERE id = ?').run(JSON.stringify(manifest), data.id)
      audit(ws.id, user.email, 'backup.inspected', { runId: data.id })
    } finally {
      await fs.promises.rm(tmp, { force: true })
    }
  })

// ── Scrubbing rules ──────────────────────────────────────────

const scrubRule = z.object({
  table: z.string().trim().min(1).max(120),
  field: z.string().trim().min(1).max(200),
  method: z.enum(['email', 'name', 'phone', 'redact', 'null', 'hash']),
})

export const getScrubRules = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  return { rules: JSON.parse(workspaceSettings(ws.id).scrub_rules ?? '[]') as ScrubRule[] }
})

export const saveScrubRules = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ rules: z.array(scrubRule).max(200) })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('settings')
    db().prepare('UPDATE workspace_settings SET scrub_rules = ? WHERE workspace_id = ?').run(JSON.stringify(data.rules), ws.id)
    audit(ws.id, user.email, 'workspace.scrub_rules_updated', { count: data.rules.length })
  })

// ── Storage dashboard ────────────────────────────────────────

export const getStorage = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  const destinations = listDestinations(ws.id)
  const copies = db()
    .prepare(
      `SELECT c.destination_id, c.created_at, c.deleted_at, r.bytes, r.instance_id, i.name AS instance_name FROM (
         SELECT rc.*, r2.started_at AS created_at FROM run_copies rc JOIN runs r2 ON r2.id = rc.run_id
       ) c JOIN runs r ON r.id = c.run_id LEFT JOIN instances i ON i.id = r.instance_id
       WHERE r.workspace_id = ? AND c.status = 'ok' AND r.bytes IS NOT NULL`,
    )
    .all(ws.id) as { destination_id: string; created_at: number; deleted_at: number | null; bytes: number; instance_id: string | null; instance_name: string | null }[]
  const live = copies.filter((c) => !c.deleted_at)
  const perDestination = destinations.map((d) => {
    const mine = live.filter((c) => c.destination_id === d.id)
    const bytes = mine.reduce((a, c) => a + c.bytes, 0)
    return { ...d, bytes, objects: mine.length, monthly: (bytes / 1024 ** 3) * d.price }
  })
  const byInstance = new Map<string, { name: string; bytes: number; objects: number; latest: number }>()
  for (const c of live) {
    const k = c.instance_id ?? 'deleted'
    const e = byInstance.get(k) ?? { name: c.instance_name ?? 'Deleted instance', bytes: 0, objects: 0, latest: 0 }
    e.bytes += c.bytes
    e.objects++
    e.latest = Math.max(e.latest, c.created_at)
    byInstance.set(k, e)
  }
  // Stored bytes per destination at the end of each of the last 90 days.
  const DAY = 86_400_000
  const end = new Date()
  end.setUTCHours(23, 59, 59, 999)
  // Window: from the first backup (at least 14 days, at most 90).
  const firstCopy = copies.reduce((a, c) => Math.min(a, c.created_at), Date.now())
  const days = Math.min(90, Math.max(14, Math.ceil((end.getTime() - firstCopy) / DAY) + 1))
  const series = Array.from({ length: days }, (_, i) => {
    const t = end.getTime() - (days - 1 - i) * DAY
    const point: Record<string, number | string> = { date: new Date(t).toISOString().slice(0, 10) }
    for (const d of destinations) {
      point[d.id] = copies.filter((c) => c.destination_id === d.id && c.created_at <= t && (!c.deleted_at || c.deleted_at > t)).reduce((a, c) => a + c.bytes, 0)
    }
    return point
  })
  return {
    destinations: perDestination,
    instances: [...byInstance.values()].sort((a, b) => b.bytes - a.bytes),
    series,
    days,
    totals: { bytes: perDestination.reduce((a, d) => a + d.bytes, 0), monthly: perDestination.reduce((a, d) => a + d.monthly, 0) },
  }
})

// ── API tokens ───────────────────────────────────────────────

export const getApiTokens = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('settings')
  return {
    tokens: db()
      .prepare('SELECT id, name, prefix, scope, created_by, created_at, expires_at, last_used_at FROM api_tokens WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
      .all(ws.id) as { id: string; name: string; prefix: string; scope: 'read' | 'run'; created_by: string; created_at: number; expires_at: number | null; last_used_at: number | null }[],
    jobs: listJobs(ws.id).map((j) => ({ id: j.id, name: j.name })),
    baseUrl: env.publicUrl,
    enabled: Boolean(workspaceSettings(ws.id).api_enabled),
  }
})

export const createApiToken = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ name: z.string().trim().min(1).max(80), scope: z.enum(['read', 'run']), expiresInDays: z.number().int().min(1).max(3650).nullable() })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('settings')
    const prefix = randomBytes(4).toString('hex')
    const secret = randomBytes(24).toString('base64url')
    const token = `cbc_${prefix}_${secret}`
    db()
      .prepare('INSERT INTO api_tokens (id, workspace_id, name, prefix, hash, scope, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), ws.id, data.name, prefix, createHash('sha256').update(token).digest('hex'), data.scope, user.email, Date.now(), data.expiresInDays ? Date.now() + data.expiresInDays * 86_400_000 : null)
    audit(ws.id, user.email, 'api_token.created', { name: data.name, scope: data.scope, prefix })
    return { token }
  })

export const setApiEnabled = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ enabled: z.boolean() })))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('settings')
    db().prepare('UPDATE workspace_settings SET api_enabled = ? WHERE workspace_id = ?').run(data.enabled ? 1 : 0, ws.id)
    audit(ws.id, user.email, data.enabled ? 'api.enabled' : 'api.disabled')
  })

export const revokeApiToken = createServerFn({ method: 'POST' })
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const { ws, user } = await requireWorkspace('settings')
    db().prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND workspace_id = ?').run(Date.now(), data.id, ws.id)
    audit(ws.id, user.email, 'api_token.revoked', { id: data.id })
  })

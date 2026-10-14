import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { auth } from './auth.server'
import { isInstanceBusy, startJob } from './backup.server'
import { ensureBooted } from './boot.server'
import { ConvexAdmin } from './convex.server'
import { decrypt, encrypt } from './crypto.server'
import { audit, db } from './db.server'
import { createEncryptionKey, encryptionIdentity, encryptionRecipient } from './encryption.server'
import { send, type ChannelConfig } from './notify.server'
import { isRestoring, startRestore } from './restore.server'
import { nextRun, syncSchedules } from './scheduler.server'
import { openDestination, type DestinationRow } from './storage.server'

async function currentUser() {
  await ensureBooted()
  const session = await auth().api.getSession({ headers: getRequest().headers })
  return session?.user ?? null
}

const requireUser = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const user = await currentUser()
  if (!user) throw new Error('Unauthorized')
  // Every action requires an enrolled second factor.
  if (!user.twoFactorEnabled) throw new Error('Two-factor authentication must be enabled first')
  return next({ context: { user } })
})

const parse =
  <T extends z.ZodType>(schema: T) =>
  (data: unknown) =>
    schema.parse(data) as z.infer<T>

const byId = z.object({ id: z.string() })

export const getUser = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await currentUser()
  return user ? { email: user.email, name: user.name, twoFactorEnabled: Boolean(user.twoFactorEnabled) } : null
})

// ── Shared row shapes ────────────────────────────────────────

type CopyRow = { destination_id: string; status: string; error: string | null; key: string; deleted: number }

function listRuns(limit: number, jobId?: string) {
  const rows = db()
    .prepare(
      `SELECT r.*, j.name AS job_name, i.name AS instance_name,
         (SELECT json_group_array(json_object('destination_id', c.destination_id, 'status', c.status, 'error', c.error, 'key', c.object_key, 'deleted', c.deleted_at IS NOT NULL))
          FROM run_copies c WHERE c.run_id = r.id) AS copies
       FROM runs r LEFT JOIN jobs j ON j.id = r.job_id LEFT JOIN instances i ON i.id = r.instance_id
       ${jobId ? 'WHERE r.job_id = ?' : ''}
       ORDER BY r.started_at DESC LIMIT ${Number(limit)}`,
    )
    .all(...(jobId ? [jobId] : [])) as Record<string, unknown>[]
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
    error: (r.error as string | null) ?? null,
    copies: (JSON.parse(String(r.copies)) as CopyRow[]).map((c) => ({ ...c, deleted: Boolean(c.deleted) })),
  }))
}
export type RunView = ReturnType<typeof listRuns>[number]

function listInstances() {
  return (
    db().prepare('SELECT id, name, url, created_at FROM instances ORDER BY name').all() as {
      id: string
      name: string
      url: string
      created_at: number
    }[]
  ).map((i) => {
    const last = db()
      .prepare("SELECT status, started_at FROM runs WHERE instance_id = ? AND status != 'running' ORDER BY started_at DESC LIMIT 1")
      .get(i.id) as { status: string; started_at: number } | undefined
    const lastOk = db()
      .prepare("SELECT started_at FROM runs WHERE instance_id = ? AND status IN ('ok', 'partial') ORDER BY started_at DESC LIMIT 1")
      .get(i.id) as { started_at: number } | undefined
    return { ...i, busy: isInstanceBusy(i.id), restoring: isRestoring(i.id), last_status: last?.status ?? null, last_ok_at: lastOk?.started_at ?? null }
  })
}

function listDestinations() {
  return (db().prepare('SELECT id, name, kind, config FROM destinations ORDER BY name').all() as DestinationRow[]).map((d) => {
    const cfg = JSON.parse(d.config) as Record<string, string | boolean | undefined>
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      summary: d.kind === 'local' ? String(cfg.root) : `${cfg.endpoint || 'AWS S3'} · ${cfg.bucket}${cfg.prefix ? '/' + cfg.prefix : ''}`,
    }
  })
}

function listJobs() {
  return (
    db()
      .prepare(
        `SELECT j.*, GROUP_CONCAT(jd.destination_id) AS destination_ids FROM jobs j
         LEFT JOIN job_destinations jd ON jd.job_id = j.id GROUP BY j.id ORDER BY j.name`,
      )
      .all() as {
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
    next_run: j.enabled && j.cron ? nextRun(j.cron) : null,
  }))
}
export type JobView = ReturnType<typeof listJobs>[number]

function listRestores(limit: number) {
  return db()
    .prepare(
      `SELECT id, run_id, object_key, target_name, mode, actor, status, confirm_message, rows_written, error, started_at, finished_at
       FROM restores ORDER BY started_at DESC LIMIT ${Number(limit)}`,
    )
    .all() as {
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

export const getOverview = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => {
    const since = Date.now() - 7 * 86_400_000
    const stats = db()
      .prepare(
        `SELECT COUNT(*) AS total, SUM(status = 'ok') AS ok, SUM(status = 'partial') AS partial, SUM(status = 'failed') AS failed,
                COALESCE(SUM(CASE WHEN status IN ('ok','partial') THEN bytes END), 0) AS bytes
         FROM runs WHERE started_at >= ?`,
      )
      .get(since) as { total: number; ok: number | null; partial: number | null; failed: number | null; bytes: number }
    return {
      instances: listInstances(),
      jobs: listJobs(),
      destinations: listDestinations(),
      runs: listRuns(8),
      restores: listRestores(3),
      stats: { total: stats.total, ok: stats.ok ?? 0, partial: stats.partial ?? 0, failed: stats.failed ?? 0, bytes: stats.bytes },
      encryption: Boolean(encryptionRecipient()),
      channels: (db().prepare('SELECT COUNT(*) AS n FROM channels').get() as { n: number }).n,
    }
  })

export const getInstances = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => ({ instances: listInstances(), jobs: listJobs() }))

export const getDestinations = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => ({ destinations: listDestinations(), jobs: listJobs() }))

export const getJobs = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => ({
    jobs: listJobs(),
    instances: listInstances(),
    destinations: listDestinations(),
    encryption: Boolean(encryptionRecipient()),
  }))

export const getRuns = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(parse(z.object({ jobId: z.string().optional() })))
  .handler(async ({ data }) => ({
    runs: listRuns(100, data.jobId),
    instances: listInstances(),
    destinations: listDestinations(),
    restores: listRestores(50),
  }))

export const getAudit = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => ({
    events: db().prepare('SELECT id, at, actor, action, detail FROM audit ORDER BY id DESC LIMIT 300').all() as {
      id: number
      at: number
      actor: string
      action: string
      detail: string | null
    }[],
  }))

// ── Instances ────────────────────────────────────────────────

const instanceInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.url().transform((u) => u.replace(/\/+$/, '')),
  adminKey: z.string().trim().min(10),
})

async function probe(url: string, adminKey: string) {
  const convex = new ConvexAdmin(url, adminKey)
  const version = await convex.version()
  await convex.latestExport() // proves the admin key works
  return version
}

export const addInstance = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(instanceInput))
  .handler(async ({ data, context }) => {
    const version = await probe(data.url, data.adminKey)
    const id = randomUUID()
    db()
      .prepare('INSERT INTO instances (id, name, url, admin_key_enc, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, data.name, data.url, encrypt(data.adminKey), Date.now())
    audit(context.user.email, 'instance.created', { id, name: data.name, url: data.url })
    return { id, version }
  })

export const updateInstance = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(z.object({ id: z.string(), name: instanceInput.shape.name, url: instanceInput.shape.url, adminKey: z.string().trim().optional() })))
  .handler(async ({ data, context }) => {
    const row = db().prepare('SELECT admin_key_enc FROM instances WHERE id = ?').get(data.id) as { admin_key_enc: string } | undefined
    if (!row) throw new Error('Instance not found')
    const key = data.adminKey || decrypt(row.admin_key_enc)
    const version = await probe(data.url, key)
    db().prepare('UPDATE instances SET name = ?, url = ?, admin_key_enc = ? WHERE id = ?').run(data.name, data.url, encrypt(key), data.id)
    audit(context.user.email, 'instance.updated', { id: data.id, name: data.name, url: data.url, keyChanged: Boolean(data.adminKey) })
    return { version }
  })

export const testInstance = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const row = db().prepare('SELECT url, admin_key_enc FROM instances WHERE id = ?').get(data.id) as
      | { url: string; admin_key_enc: string }
      | undefined
    if (!row) throw new Error('Instance not found')
    return { version: await probe(row.url, decrypt(row.admin_key_enc)) }
  })

export const deleteInstance = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(byId))
  .handler(async ({ data, context }) => {
    db().prepare('DELETE FROM instances WHERE id = ?').run(data.id)
    syncSchedules()
    audit(context.user.email, 'instance.deleted', data)
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
  }),
  z.object({
    kind: z.literal('local'),
    name: z.string().trim().min(1).max(80),
    root: z.string().trim().startsWith('/'),
  }),
])

export const addDestination = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(destinationInput))
  .handler(async ({ data, context }) => {
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
            }),
            secret_enc: encrypt(data.secretAccessKey),
          }
        : { id, name: data.name, kind: 'local', config: JSON.stringify({ root: data.root }), secret_enc: null }
    await openDestination(row).test()
    db()
      .prepare('INSERT INTO destinations (id, name, kind, config, secret_enc, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.kind, row.config, row.secret_enc, Date.now())
    audit(context.user.email, 'destination.created', { id, name: data.name, kind: data.kind })
    return { id }
  })

export const testDestination = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(byId))
  .handler(async ({ data }) => {
    const row = db().prepare('SELECT * FROM destinations WHERE id = ?').get(data.id) as DestinationRow | undefined
    if (!row) throw new Error('Destination not found')
    await openDestination(row).test()
    return { ok: true }
  })

export const deleteDestination = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(byId))
  .handler(async ({ data, context }) => {
    db().prepare('DELETE FROM destinations WHERE id = ?').run(data.id)
    audit(context.user.email, 'destination.deleted', data)
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

function writeJob(id: string, data: z.infer<typeof jobInput>, isNew: boolean) {
  if (data.encrypt && !encryptionRecipient()) throw new Error('Create an encryption key in Settings first')
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
          `INSERT INTO jobs (name, instance_id, include_storage, encrypt, cron, keep_last, keep_daily, keep_weekly, keep_monthly, id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...values, id, Date.now())
    } else {
      db()
        .prepare(
          `UPDATE jobs SET name = ?, instance_id = ?, include_storage = ?, encrypt = ?, cron = ?, keep_last = ?, keep_daily = ?,
           keep_weekly = ?, keep_monthly = ? WHERE id = ?`,
        )
        .run(...values, id)
      db().prepare('DELETE FROM job_destinations WHERE job_id = ?').run(id)
    }
    const link = db().prepare('INSERT INTO job_destinations (job_id, destination_id) VALUES (?, ?)')
    for (const d of data.destinationIds) link.run(id, d)
  })()
  syncSchedules()
}

export const addJob = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(jobInput))
  .handler(async ({ data, context }) => {
    const id = randomUUID()
    writeJob(id, data, true)
    audit(context.user.email, 'job.created', { id, ...data })
    return { id }
  })

export const updateJob = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(jobInput.extend({ id: z.string() })))
  .handler(async ({ data: { id, ...data }, context }) => {
    writeJob(id, data, false)
    audit(context.user.email, 'job.updated', { id, ...data })
  })

export const setJobEnabled = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(z.object({ id: z.string(), enabled: z.boolean() })))
  .handler(async ({ data, context }) => {
    db().prepare('UPDATE jobs SET enabled = ? WHERE id = ?').run(data.enabled ? 1 : 0, data.id)
    syncSchedules()
    audit(context.user.email, data.enabled ? 'job.enabled' : 'job.disabled', { id: data.id })
  })

export const deleteJob = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(byId))
  .handler(async ({ data, context }) => {
    db().prepare('DELETE FROM jobs WHERE id = ?').run(data.id)
    syncSchedules()
    audit(context.user.email, 'job.deleted', data)
  })

export const runJobNow = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(byId))
  .handler(async ({ data, context }) => {
    const runId = startJob(data.id, `manual:${context.user.email}`)
    audit(context.user.email, 'backup.started', { jobId: data.id, runId })
    return { runId }
  })

// ── Restore ──────────────────────────────────────────────────

export const restoreBackup = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    parse(
      z.object({
        runId: z.string(),
        destinationId: z.string(),
        targetInstanceId: z.string(),
        mode: z.enum(['replaceAll', 'replace', 'append', 'requireEmpty']),
        confirm: z.string(),
      }),
    ),
  )
  .handler(async ({ data, context }) => ({ restoreId: startRestore({ ...data, actor: context.user.email }) }))

// ── Notification channels ────────────────────────────────────

const channelConfig = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('webhook'), url: z.url() }),
  z.object({ kind: z.literal('discord'), url: z.url() }),
  z.object({ kind: z.literal('slack'), url: z.url() }),
  z.object({ kind: z.literal('telegram'), botToken: z.string().trim().min(10), chatId: z.string().trim().min(1) }),
  z.object({
    kind: z.literal('email'),
    host: z.string().trim().min(1),
    port: z.coerce.number().int().positive(),
    secure: z.boolean().default(false),
    user: z.string().trim().optional(),
    pass: z.string().optional(),
    from: z.string().trim().min(3),
    to: z.string().trim().min(3),
  }),
])
const channelInput = z.object({
  name: z.string().trim().min(1).max(80),
  onFailure: z.boolean().default(true),
  onSuccess: z.boolean().default(false),
  config: channelConfig,
})

export const getChannels = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => ({
    channels: (
      db().prepare('SELECT id, name, kind, config_enc, on_failure, on_success FROM channels ORDER BY name').all() as {
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
  }))

function describeTarget(cfg: ChannelConfig) {
  switch (cfg.kind) {
    case 'telegram':
      return `chat ${cfg.chatId}`
    case 'email':
      return `${cfg.to} via ${cfg.host}:${cfg.port}`
    default: {
      const u = new URL(cfg.url)
      return `${u.host}${u.pathname.length > 1 ? '/…' : ''}`
    }
  }
}

export const addChannel = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(channelInput))
  .handler(async ({ data, context }) => {
    const id = randomUUID()
    db()
      .prepare('INSERT INTO channels (id, name, kind, config_enc, on_failure, on_success, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, data.name, data.config.kind, encrypt(JSON.stringify(data.config)), data.onFailure ? 1 : 0, data.onSuccess ? 1 : 0, Date.now())
    audit(context.user.email, 'channel.created', { id, name: data.name, kind: data.config.kind })
    return { id }
  })

export const setChannelEvents = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(z.object({ id: z.string(), onFailure: z.boolean(), onSuccess: z.boolean() })))
  .handler(async ({ data, context }) => {
    db().prepare('UPDATE channels SET on_failure = ?, on_success = ? WHERE id = ?').run(data.onFailure ? 1 : 0, data.onSuccess ? 1 : 0, data.id)
    audit(context.user.email, 'channel.updated', data)
  })

export const testChannel = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(byId))
  .handler(async ({ data, context }) => {
    const row = db().prepare('SELECT name, config_enc FROM channels WHERE id = ?').get(data.id) as
      | { name: string; config_enc: string }
      | undefined
    if (!row) throw new Error('Channel not found')
    await send(JSON.parse(decrypt(row.config_enc)) as ChannelConfig, {
      type: 'test',
      status: 'ok',
      title: 'Test notification from Convex Backup Console',
      details: [`Channel: ${row.name}`, `Sent by ${context.user.email}`],
    })
  })

export const deleteChannel = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(byId))
  .handler(async ({ data, context }) => {
    db().prepare('DELETE FROM channels WHERE id = ?').run(data.id)
    audit(context.user.email, 'channel.deleted', data)
  })

// ── Encryption ───────────────────────────────────────────────

export const getEncryption = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => ({ recipient: encryptionRecipient() }))

export const createEncryption = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const key = await createEncryptionKey()
    audit(context.user.email, 'encryption.key_created', { recipient: key.recipient })
    return key
  })

export const revealEncryptionKey = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    audit(context.user.email, 'encryption.key_revealed')
    return { identity: encryptionIdentity() }
  })

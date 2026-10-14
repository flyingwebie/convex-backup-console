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

export const getUser = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await currentUser()
  return user ? { email: user.email, twoFactorEnabled: Boolean(user.twoFactorEnabled) } : null
})

export const getDashboard = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => {
    const instances = (
      db().prepare('SELECT id, name, url, created_at FROM instances ORDER BY name').all() as {
        id: string
        name: string
        url: string
        created_at: number
      }[]
    ).map((i) => ({ ...i, busy: isInstanceBusy(i.id), restoring: isRestoring(i.id) }))
    const destinations = (db().prepare('SELECT id, name, kind, config FROM destinations ORDER BY name').all() as DestinationRow[]).map(
      (d) => ({ id: d.id, name: d.name, kind: d.kind, summary: summarize(d) }),
    )
    const jobs = (
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
        cron: string | null
        keep_last: number | null
        enabled: number
        destination_ids: string | null
      }[]
    ).map((j) => ({
      ...j,
      destination_ids: j.destination_ids ? j.destination_ids.split(',') : [],
      next_run: j.enabled && j.cron ? nextRun(j.cron) : null,
    }))
    const runs = db()
      .prepare(
        `SELECT r.*, j.name AS job_name, i.name AS instance_name,
           (SELECT json_group_array(json_object('destination_id', c.destination_id, 'status', c.status, 'error', c.error, 'key', c.object_key, 'deleted', c.deleted_at IS NOT NULL))
            FROM run_copies c WHERE c.run_id = r.id) AS copies
         FROM runs r LEFT JOIN jobs j ON j.id = r.job_id LEFT JOIN instances i ON i.id = r.instance_id
         ORDER BY r.started_at DESC LIMIT 30`,
      )
      .all() as Record<string, unknown>[]
    const restores = db()
      .prepare(
        `SELECT id, object_key, target_name, mode, actor, status, confirm_message, rows_written, error, started_at, finished_at
         FROM restores ORDER BY started_at DESC LIMIT 10`,
      )
      .all() as {
      id: string
      object_key: string
      target_name: string
      mode: string
      actor: string
      status: string
      confirm_message: string | null
      rows_written: number | null
      error: string | null
      started_at: number
      finished_at: number | null
    }[]
    return {
      instances,
      destinations,
      jobs,
      restores,
      runs: runs.map((r) => ({
        id: String(r.id),
        job_name: (r.job_name as string | null) ?? '(deleted job)',
        instance_name: (r.instance_name as string | null) ?? '(deleted instance)',
        trigger: String(r.trigger),
        status: String(r.status),
        started_at: Number(r.started_at),
        finished_at: r.finished_at == null ? null : Number(r.finished_at),
        bytes: r.bytes == null ? null : Number(r.bytes),
        error: (r.error as string | null) ?? null,
        copies: JSON.parse(String(r.copies)) as { destination_id: string; status: string; error: string | null; key: string; deleted: number }[],
      })),
    }
  })

function summarize(d: DestinationRow) {
  const cfg = JSON.parse(d.config) as Record<string, string>
  return d.kind === 'local' ? cfg.root : `${cfg.endpoint || 'aws'} · ${cfg.bucket}${cfg.prefix ? '/' + cfg.prefix : ''}`
}

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

export const testInstance = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(z.object({ id: z.string() })))
  .handler(async ({ data }) => {
    const row = db().prepare('SELECT url, admin_key_enc FROM instances WHERE id = ?').get(data.id) as
      | { url: string; admin_key_enc: string }
      | undefined
    if (!row) throw new Error('Instance not found')
    return { version: await probe(row.url, decrypt(row.admin_key_enc)) }
  })

export const updateInstance = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(z.object({ id: z.string(), url: instanceInput.shape.url, adminKey: instanceInput.shape.adminKey })))
  .handler(async ({ data, context }) => {
    const version = await probe(data.url, data.adminKey)
    db().prepare('UPDATE instances SET url = ?, admin_key_enc = ? WHERE id = ?').run(data.url, encrypt(data.adminKey), data.id)
    audit(context.user.email, 'instance.updated', { id: data.id, url: data.url })
    return { version }
  })

export const deleteInstance = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(z.object({ id: z.string() })))
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
              region: data.region,
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
  .validator(parse(z.object({ id: z.string() })))
  .handler(async ({ data }) => {
    const row = db().prepare('SELECT * FROM destinations WHERE id = ?').get(data.id) as DestinationRow | undefined
    if (!row) throw new Error('Destination not found')
    await openDestination(row).test()
    return { ok: true }
  })

export const deleteDestination = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(z.object({ id: z.string() })))
  .handler(async ({ data, context }) => {
    db().prepare('DELETE FROM destinations WHERE id = ?').run(data.id)
    audit(context.user.email, 'destination.deleted', data)
  })

// ── Jobs ─────────────────────────────────────────────────────

const jobInput = z.object({
  name: z.string().trim().min(1).max(80),
  instanceId: z.string(),
  destinationIds: z.array(z.string()).min(1),
  includeStorage: z.boolean().default(true),
  cron: z
    .string()
    .trim()
    .optional()
    .transform((c) => c || null)
    .refine((c) => c === null || nextRun(c) !== null, 'Invalid cron expression'),
  keepLast: z.number().int().positive().nullable().default(null),
})

export const addJob = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(jobInput))
  .handler(async ({ data, context }) => {
    const id = randomUUID()
    const tx = db().transaction(() => {
      db()
        .prepare('INSERT INTO jobs (id, name, instance_id, include_storage, cron, keep_last, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, data.name, data.instanceId, data.includeStorage ? 1 : 0, data.cron, data.keepLast, Date.now())
      const link = db().prepare('INSERT INTO job_destinations (job_id, destination_id) VALUES (?, ?)')
      for (const d of data.destinationIds) link.run(id, d)
    })
    tx()
    syncSchedules()
    audit(context.user.email, 'job.created', { id, ...data })
    return { id }
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
  .validator(parse(z.object({ id: z.string() })))
  .handler(async ({ data, context }) => {
    db().prepare('DELETE FROM jobs WHERE id = ?').run(data.id)
    syncSchedules()
    audit(context.user.email, 'job.deleted', data)
  })

export const runJobNow = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parse(z.object({ id: z.string() })))
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

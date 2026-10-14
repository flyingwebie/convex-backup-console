import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { ConvexAdmin } from './convex.server'
import { decrypt } from './crypto.server'
import { audit, db } from './db.server'
import { encryptFile } from './encryption.server'
import { env } from './env.server'
import { notify } from './notify.server'
import { selectToKeep } from './retention'
import { openDestination, type DestinationRow } from './storage.server'
import { inspectZip, sha256File } from './zip.server'

type JobRow = {
  id: string
  workspace_id: string
  name: string
  instance_id: string
  include_storage: number
  encrypt: number
  keep_last: number | null
  keep_daily: number | null
  keep_weekly: number | null
  keep_monthly: number | null
}
type InstanceRow = { id: string; name: string; url: string; admin_key_enc: string }

// Convex allows one snapshot export at a time per deployment.
const running = new Set<string>()

export function isInstanceBusy(instanceId: string) {
  return running.has(instanceId)
}

/** Starts a job in the background and returns the run id immediately. */
export function startJob(jobId: string, trigger: string): string {
  const job = db().prepare('SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL').get(jobId) as JobRow | undefined
  if (!job) throw new Error('Job not found')
  if (running.has(job.instance_id)) throw new Error('A backup for this instance is already running')
  const runId = randomUUID()
  db()
    .prepare('INSERT INTO runs (id, workspace_id, job_id, instance_id, trigger, status, started_at, encrypted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(runId, job.workspace_id, job.id, job.instance_id, trigger, 'running', Date.now(), job.encrypt)
  running.add(job.instance_id)
  void runJob(runId, job)
    .catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      db().prepare('UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run('failed', message, Date.now(), runId)
      audit(job.workspace_id, 'system', 'backup.failed', { runId, jobId: job.id, error: message })
      await notify(job.workspace_id, { type: 'backup', status: 'failed', title: `Backup failed: ${job.name}`, details: [message] })
    })
    .finally(() => running.delete(job.instance_id))
  return runId
}

async function runJob(runId: string, job: JobRow) {
  const instance = db().prepare('SELECT * FROM instances WHERE id = ?').get(job.instance_id) as InstanceRow
  const destinations = db()
    .prepare('SELECT d.* FROM destinations d JOIN job_destinations jd ON jd.destination_id = d.id WHERE jd.job_id = ? AND d.deleted_at IS NULL')
    .all(job.id) as DestinationRow[]
  if (destinations.length === 0) throw new Error('Job has no destinations')

  const convex = new ConvexAdmin(instance.url, decrypt(instance.admin_key_enc))
  const snapshot = await convex.exportAndWait(job.include_storage === 1)

  const tmpDir = path.join(env.dataDir, 'tmp')
  await fs.promises.mkdir(tmpDir, { recursive: true })
  const zipFile = path.join(tmpDir, `${runId}.zip`)
  const uploadFile = job.encrypt ? `${zipFile}.age` : zipFile
  try {
    const res = await convex.downloadExport(snapshot.start_ts)
    if (!res.body) throw new Error('Export download returned no body')
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), fs.createWriteStream(zipFile))
    // Manifest of what's inside (tables, row counts, files) for browsing, comparing and partial restores.
    const manifest = await inspectZip(zipFile).catch(() => null)
    if (manifest) manifest.convexVersion = await convex.version().catch(() => undefined)
    if (job.encrypt) await encryptFile(job.workspace_id, zipFile, uploadFile)
    const { size } = await fs.promises.stat(uploadFile)
    const sha256 = await sha256File(uploadFile)
    db().prepare('UPDATE runs SET manifest = ?, sha256 = ? WHERE id = ?').run(manifest ? JSON.stringify(manifest) : null, sha256, runId)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const key = `${slug(instance.name)}/${stamp}.zip${job.encrypt ? '.age' : ''}`
    const failures: string[] = []
    for (const dest of destinations) {
      try {
        const put = await openDestination(dest).put(key, uploadFile)
        insertCopy(runId, dest.id, key, 'ok', null, put.versionId, put.lockedUntil)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        insertCopy(runId, dest.id, key, 'failed', message)
        failures.push(`${dest.name}: ${message}`)
      }
    }
    if (failures.length === destinations.length) throw new Error(`Upload failed on every destination — ${failures.join('; ')}`)

    // Only clean up the source once we hold at least one copy.
    await convex.expireExport(snapshot._id).catch((err: unknown) => {
      audit(job.workspace_id, 'system', 'export.expire_failed', { runId, error: String(err) })
    })

    const status = failures.length ? 'partial' : 'ok'
    db().prepare('UPDATE runs SET status = ?, bytes = ?, finished_at = ? WHERE id = ?').run(status, size, Date.now(), runId)
    audit(job.workspace_id, 'system', 'backup.completed', { runId, jobId: job.id, status, bytes: size })
    await applyRetention(job)
    await notify(job.workspace_id, {
      type: 'backup',
      status,
      title: `${status === 'ok' ? 'Backup completed' : 'Backup partially failed'}: ${job.name}`,
      details: [
        `Instance: ${instance.name}`,
        `Size: ${(size / 1024 / 1024).toFixed(1)} MB${job.encrypt ? ' (encrypted)' : ''}`,
        `Copies: ${destinations.length - failures.length}/${destinations.length}`,
        ...failures,
      ],
    })
  } finally {
    await fs.promises.rm(zipFile, { force: true })
    await fs.promises.rm(`${zipFile}.age`, { force: true })
  }
}

function insertCopy(runId: string, destinationId: string, key: string, status: string, error: string | null, versionId?: string, lockedUntil?: number) {
  db()
    .prepare('INSERT INTO run_copies (run_id, destination_id, object_key, status, error, version_id, locked_until) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(runId, destinationId, key, status, error, versionId ?? null, lockedUntil ?? null)
}

/** Applies the job's retention policy separately on each destination. */
async function applyRetention(job: JobRow) {
  const policy = { keepLast: job.keep_last, keepDaily: job.keep_daily, keepWeekly: job.keep_weekly, keepMonthly: job.keep_monthly }
  const copies = db()
    .prepare(
      `SELECT c.run_id, c.destination_id, c.object_key, c.version_id, c.locked_until, r.started_at FROM run_copies c JOIN runs r ON r.id = c.run_id
       WHERE r.job_id = ? AND c.status = 'ok' AND c.deleted_at IS NULL`,
    )
    .all(job.id) as { run_id: string; destination_id: string; object_key: string; version_id: string | null; locked_until: number | null; started_at: number }[]
  const byDest = Map.groupBy(copies, (c) => c.destination_id)
  for (const [destinationId, list] of byDest) {
    const keep = selectToKeep(list.map((c) => ({ id: c.run_id, at: c.started_at })), policy)
    // Copies still under Object Lock can't be deleted yet; retention picks them up once unlocked.
    const doomed = list.filter((c) => !keep.has(c.run_id) && !(c.locked_until && c.locked_until > Date.now()))
    if (!doomed.length) continue
    const dest = openDestination(db().prepare('SELECT * FROM destinations WHERE id = ?').get(destinationId) as DestinationRow)
    for (const copy of doomed) {
      try {
        await dest.delete(copy.object_key, copy.version_id)
        db().prepare('UPDATE run_copies SET deleted_at = ? WHERE run_id = ? AND destination_id = ?').run(Date.now(), copy.run_id, destinationId)
      } catch (err) {
        audit(job.workspace_id, 'system', 'retention.delete_failed', { ...copy, error: String(err) })
      }
    }
  }
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'instance'
}

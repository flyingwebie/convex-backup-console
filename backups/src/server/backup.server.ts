import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ConvexAdmin } from './convex.server'
import { decrypt } from './crypto.server'
import { audit, db } from './db.server'
import { env } from './env.server'
import { openDestination, type DestinationRow } from './storage.server'

type JobRow = {
  id: string
  name: string
  instance_id: string
  include_storage: number
  keep_last: number | null
}
type InstanceRow = { id: string; name: string; url: string; admin_key_enc: string }

// Convex allows one snapshot export at a time per deployment.
const running = new Set<string>()

export function isInstanceBusy(instanceId: string) {
  return running.has(instanceId)
}

/** Starts a job in the background and returns the run id immediately. */
export function startJob(jobId: string, trigger: string): string {
  const job = db().prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined
  if (!job) throw new Error('Job not found')
  if (running.has(job.instance_id)) throw new Error('A backup for this instance is already running')
  const runId = randomUUID()
  db()
    .prepare('INSERT INTO runs (id, job_id, instance_id, trigger, status, started_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(runId, job.id, job.instance_id, trigger, 'running', Date.now())
  running.add(job.instance_id)
  void runJob(runId, job)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      db().prepare('UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run('failed', message, Date.now(), runId)
      audit('system', 'backup.failed', { runId, jobId: job.id, error: message })
    })
    .finally(() => running.delete(job.instance_id))
  return runId
}

async function runJob(runId: string, job: JobRow) {
  const instance = db().prepare('SELECT * FROM instances WHERE id = ?').get(job.instance_id) as InstanceRow
  const destinations = db()
    .prepare('SELECT d.* FROM destinations d JOIN job_destinations jd ON jd.destination_id = d.id WHERE jd.job_id = ?')
    .all(job.id) as DestinationRow[]
  if (destinations.length === 0) throw new Error('Job has no destinations')

  const convex = new ConvexAdmin(instance.url, decrypt(instance.admin_key_enc))
  const snapshot = await convex.exportAndWait(job.include_storage === 1)

  const tmpDir = path.join(env.dataDir, 'tmp')
  await fs.promises.mkdir(tmpDir, { recursive: true })
  const tmpFile = path.join(tmpDir, `${runId}.zip`)
  try {
    const res = await convex.downloadExport(snapshot.start_ts)
    if (!res.body) throw new Error('Export download returned no body')
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), fs.createWriteStream(tmpFile))
    const { size } = await fs.promises.stat(tmpFile)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const key = `${slug(instance.name)}/${stamp}.zip`
    let ok = 0
    for (const dest of destinations) {
      try {
        await openDestination(dest).put(key, tmpFile)
        insertCopy(runId, dest.id, key, 'ok', null)
        ok++
      } catch (err) {
        insertCopy(runId, dest.id, key, 'failed', err instanceof Error ? err.message : String(err))
      }
    }
    if (ok === 0) throw new Error('Upload failed on every destination')

    // Only clean up the source once we hold at least one copy.
    await convex.expireExport(snapshot._id).catch((err: unknown) => {
      audit('system', 'export.expire_failed', { runId, error: String(err) })
    })

    const status = ok === destinations.length ? 'ok' : 'partial'
    db().prepare('UPDATE runs SET status = ?, bytes = ?, finished_at = ? WHERE id = ?').run(status, size, Date.now(), runId)
    audit('system', 'backup.completed', { runId, jobId: job.id, status, bytes: size })
    if (job.keep_last) await applyRetention(job.id, job.keep_last)
  } finally {
    await fs.promises.rm(tmpFile, { force: true })
  }
}

function insertCopy(runId: string, destinationId: string, key: string, status: string, error: string | null) {
  db()
    .prepare('INSERT INTO run_copies (run_id, destination_id, object_key, status, error) VALUES (?, ?, ?, ?, ?)')
    .run(runId, destinationId, key, status, error)
}

/** Keeps the newest `keepLast` successful copies per destination for this job; deletes older ones. */
async function applyRetention(jobId: string, keepLast: number) {
  const copies = db()
    .prepare(
      `SELECT c.run_id, c.destination_id, c.object_key FROM run_copies c JOIN runs r ON r.id = c.run_id
       WHERE r.job_id = ? AND c.status = 'ok' AND c.deleted_at IS NULL ORDER BY r.started_at DESC`,
    )
    .all(jobId) as { run_id: string; destination_id: string; object_key: string }[]
  const seen = new Map<string, number>()
  for (const copy of copies) {
    const n = (seen.get(copy.destination_id) ?? 0) + 1
    seen.set(copy.destination_id, n)
    if (n <= keepLast) continue
    const dest = db().prepare('SELECT * FROM destinations WHERE id = ?').get(copy.destination_id) as DestinationRow
    try {
      await openDestination(dest).delete(copy.object_key)
      db()
        .prepare('UPDATE run_copies SET deleted_at = ? WHERE run_id = ? AND destination_id = ?')
        .run(Date.now(), copy.run_id, copy.destination_id)
    } catch (err) {
      audit('system', 'retention.delete_failed', { ...copy, error: String(err) })
    }
  }
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'instance'
}

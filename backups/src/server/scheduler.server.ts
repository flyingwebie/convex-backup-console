import { Cron } from 'croner'
import { db } from './db.server'
import { startJob } from './backup.server'

const g = globalThis as { __crons?: Map<string, Cron> }

/** (Re)builds cron timers from the jobs table. Called at boot and after job edits. */
export function syncSchedules() {
  const crons = (g.__crons ??= new Map())
  for (const c of crons.values()) c.stop()
  crons.clear()
  const jobs = db()
    .prepare(
      `SELECT j.id, j.cron, COALESCE(s.timezone, 'UTC') AS timezone FROM jobs j
       JOIN instances i ON i.id = j.instance_id
       LEFT JOIN workspace_settings s ON s.workspace_id = j.workspace_id
       WHERE j.enabled = 1 AND j.cron IS NOT NULL AND j.deleted_at IS NULL AND i.deleted_at IS NULL AND s.deleted_at IS NULL`,
    )
    .all() as { id: string; cron: string; timezone: string }[]
  for (const job of jobs) {
    crons.set(
      job.id,
      new Cron(job.cron, { protect: true, timezone: job.timezone }, () => {
        try {
          startJob(job.id, 'schedule')
        } catch (err) {
          console.error(`[scheduler] job ${job.id}:`, err)
        }
      }),
    )
  }
}

export function nextRun(cron: string, timezone = 'UTC'): number | null {
  try {
    return new Cron(cron, { timezone }).nextRun()?.getTime() ?? null
  } catch {
    return null
  }
}

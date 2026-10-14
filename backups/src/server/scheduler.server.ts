import { Cron } from 'croner'
import { db } from './db.server'
import { startJob } from './backup.server'

const g = globalThis as { __crons?: Map<string, Cron> }

/** (Re)builds cron timers from the jobs table. Called at boot and after job edits. */
export function syncSchedules() {
  const crons = (g.__crons ??= new Map())
  for (const c of crons.values()) c.stop()
  crons.clear()
  const jobs = db().prepare('SELECT id, cron FROM jobs WHERE enabled = 1 AND cron IS NOT NULL').all() as {
    id: string
    cron: string
  }[]
  for (const job of jobs) {
    crons.set(
      job.id,
      new Cron(job.cron, { protect: true }, () => {
        try {
          startJob(job.id, 'schedule')
        } catch (err) {
          console.error(`[scheduler] job ${job.id}:`, err)
        }
      }),
    )
  }
}

export function nextRun(cron: string): number | null {
  return new Cron(cron).nextRun()?.getTime() ?? null
}

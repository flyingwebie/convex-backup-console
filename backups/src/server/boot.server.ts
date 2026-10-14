import { migrateAuth, seedAdmin } from './auth.server'
import { db } from './db.server'
import { syncSchedules } from './scheduler.server'

const g = globalThis as { __boot?: Promise<void> }

export function ensureBooted(): Promise<void> {
  return (g.__boot ??= (async () => {
    await migrateAuth()
    await seedAdmin()
    // Runs that were in flight when the process died will never finish.
    db()
      .prepare("UPDATE runs SET status = 'failed', error = 'Interrupted by restart', finished_at = ? WHERE status = 'running'")
      .run(Date.now())
    syncSchedules()
  })().catch((err) => {
    g.__boot = undefined
    throw err
  }))
}

import { migrateAuth, seedAdmin } from './auth.server'
import { db } from './db.server'
import { startPurgeLoop } from './purge.server'
import { syncSchedules } from './scheduler.server'
import { bootstrapWorkspaces } from './workspace.server'

const g = globalThis as { __boot?: Promise<void> }

export function ensureBooted(): Promise<void> {
  return (g.__boot ??= (async () => {
    await migrateAuth()
    await seedAdmin()
    await bootstrapWorkspaces()
    // Runs that were in flight when the process died will never finish.
    db()
      .prepare("UPDATE runs SET status = 'failed', error = 'Interrupted by restart', finished_at = ? WHERE status = 'running'")
      .run(Date.now())
    syncSchedules()
    startPurgeLoop()
  })().catch((err) => {
    g.__boot = undefined
    throw err
  }))
}

import { audit, db } from './db.server'
import { sendDueDigests } from './digest.server'
import { checkStaleInstances } from './email/events.server'
import { syncSchedules } from './scheduler.server'
import { openDestination, type DestinationRow } from './storage.server'
import { workspaceSettings } from './workspace.server'

// Deletion policy: deleted workspaces, instances, jobs and destinations sit in the Trash for the
// workspace's `trash_days`, then are purged. `purge_remote` / `purge_local` decide whether the backup
// files they produced are deleted from S3-compatible / local-volume destinations too (default: keep),
// `purge_remote_days` / `purge_local_days` after the purge (0 = at the purge).

export type TrashKind = 'instance' | 'job' | 'destination'
const TABLE: Record<TrashKind, string> = { instance: 'instances', job: 'jobs', destination: 'destinations' }
const DAY = 86_400_000

export function softDelete(workspaceId: string, kind: TrashKind, id: string, actor: string) {
  const now = Date.now()
  db().transaction(() => {
    const res = db()
      .prepare(`UPDATE ${TABLE[kind]} SET deleted_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`)
      .run(now, id, workspaceId)
    if (res.changes === 0) throw new Error('Not found')
    // An instance's jobs go to the trash with it (same timestamp, so they're restored together).
    if (kind === 'instance') db().prepare('UPDATE jobs SET deleted_at = ? WHERE instance_id = ? AND deleted_at IS NULL').run(now, id)
  })()
  syncSchedules()
  audit(workspaceId, actor, `${kind}.deleted`, { id })
  if (workspaceSettings(workspaceId).trash_days === 0) return purgeItem(workspaceId, kind, id, actor)
}

export function restoreItem(workspaceId: string, kind: TrashKind, id: string, actor: string) {
  const row = db().prepare(`SELECT deleted_at FROM ${TABLE[kind]} WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
    | { deleted_at: number | null }
    | undefined
  if (!row?.deleted_at) throw new Error('Not in the trash')
  if (kind === 'job') {
    const parent = db().prepare('SELECT i.deleted_at FROM jobs j JOIN instances i ON i.id = j.instance_id WHERE j.id = ?').get(id) as { deleted_at: number | null }
    if (parent.deleted_at) throw new Error('Restore its instance first')
  }
  try {
    db().transaction(() => {
      db().prepare(`UPDATE ${TABLE[kind]} SET deleted_at = NULL WHERE id = ?`).run(id)
      if (kind === 'instance') db().prepare('UPDATE jobs SET deleted_at = NULL WHERE instance_id = ? AND deleted_at = ?').run(id, row.deleted_at)
    })()
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new Error('Something with the same name exists now — rename it first')
    throw err
  }
  syncSchedules()
  audit(workspaceId, actor, `${kind}.restored`, { id })
}

type Copy = { run_id: string; destination_id: string; object_key: string; version_id: string | null; locked_until: number | null }

/** Deletes one stored copy. Files under Object Lock are rescheduled for when their lock expires. */
async function deleteCopy(workspaceId: string, c: Copy) {
  if (c.locked_until && c.locked_until > Date.now()) {
    db().prepare('UPDATE run_copies SET delete_after = ? WHERE run_id = ? AND destination_id = ?').run(c.locked_until, c.run_id, c.destination_id)
    audit(workspaceId, 'system', 'purge.skipped_locked', { key: c.object_key, lockedUntil: new Date(c.locked_until).toISOString() })
    return false
  }
  const dest = db().prepare('SELECT * FROM destinations WHERE id = ?').get(c.destination_id) as DestinationRow | undefined
  if (!dest) return false
  try {
    await openDestination(dest).delete(c.object_key, c.version_id)
    db()
      .prepare('UPDATE run_copies SET deleted_at = ?, delete_after = NULL WHERE run_id = ? AND destination_id = ?')
      .run(Date.now(), c.run_id, c.destination_id)
    return true
  } catch (err) {
    // Retry tomorrow rather than every hour.
    db().prepare('UPDATE run_copies SET delete_after = ? WHERE run_id = ? AND destination_id = ?').run(Date.now() + DAY, c.run_id, c.destination_id)
    audit(workspaceId, 'system', 'purge.delete_failed', { ...c, error: String(err) })
    return false
  }
}

/** Storage types whose files the policy deletes, with the delay (days after purge) for each. */
function purgeDelays(workspaceId: string) {
  const s = workspaceSettings(workspaceId)
  return { s3: s.purge_remote ? s.purge_remote_days : null, local: s.purge_local ? s.purge_local_days : null } as Record<'s3' | 'local', number | null>
}

/**
 * Deletes the stored backup files for runs matching `where`, on the storage types the policy allows —
 * now, or after that type's delay (`immediate` ignores the delays, used when the workspace itself goes).
 */
async function deleteBackups(workspaceId: string, where: string, param: string, immediate = false) {
  const delays = purgeDelays(workspaceId)
  const kinds = (Object.keys(delays) as ('s3' | 'local')[]).filter((k) => delays[k] !== null)
  if (!kinds.length) return { deleted: 0, scheduled: 0 }
  const copies = db()
    .prepare(
      `SELECT c.run_id, c.destination_id, c.object_key, c.version_id, c.locked_until, d.kind FROM run_copies c JOIN runs r ON r.id = c.run_id
       JOIN destinations d ON d.id = c.destination_id
       WHERE ${where} = ? AND c.status = 'ok' AND c.deleted_at IS NULL AND d.kind IN (${kinds.map((k) => `'${k}'`).join(', ')})`,
    )
    .all(param) as (Copy & { kind: 's3' | 'local' })[]
  let deleted = 0
  let scheduled = 0
  for (const c of copies) {
    const days = immediate ? 0 : (delays[c.kind] ?? 0)
    if (days > 0) {
      db().prepare('UPDATE run_copies SET delete_after = ? WHERE run_id = ? AND destination_id = ?').run(Date.now() + days * DAY, c.run_id, c.destination_id)
      scheduled++
    } else if (await deleteCopy(workspaceId, c)) deleted++
  }
  return { deleted, scheduled }
}

/** Deletes backup files whose delay has passed. Turning the policy off for a storage type cancels its pending deletions. */
async function deleteDueBackups() {
  const due = db()
    .prepare(
      `SELECT c.run_id, c.destination_id, c.object_key, c.version_id, c.locked_until, d.kind, r.workspace_id FROM run_copies c
       JOIN runs r ON r.id = c.run_id JOIN destinations d ON d.id = c.destination_id
       WHERE c.delete_after IS NOT NULL AND c.delete_after <= ? AND c.deleted_at IS NULL`,
    )
    .all(Date.now()) as (Copy & { kind: 's3' | 'local'; workspace_id: string })[]
  for (const c of due) {
    if (purgeDelays(c.workspace_id)[c.kind] === null) {
      db().prepare('UPDATE run_copies SET delete_after = NULL WHERE run_id = ? AND destination_id = ?').run(c.run_id, c.destination_id)
      continue
    }
    await deleteCopy(c.workspace_id, c)
  }
}

/** Permanently removes a trashed item, applying the workspace's backup policy. */
export async function purgeItem(workspaceId: string, kind: TrashKind, id: string, actor: string) {
  const row = db().prepare(`SELECT name, deleted_at FROM ${TABLE[kind]} WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
    | { name: string; deleted_at: number | null }
    | undefined
  if (!row?.deleted_at) throw new Error('Not in the trash')
  let backups = { deleted: 0, scheduled: 0 }
  if (kind !== 'destination') {
    backups = await deleteBackups(workspaceId, kind === 'job' ? 'r.job_id' : 'r.instance_id', id)
  }
  // Destination files are never touched: once its credentials are gone they can't be, and the
  // operator may still want them. run_copies rows cascade away with the destination.
  db().prepare(`DELETE FROM ${TABLE[kind]} WHERE id = ?`).run(id)
  syncSchedules()
  audit(workspaceId, actor, `${kind}.purged`, { id, name: row.name, backupsDeleted: backups.deleted, backupsScheduled: backups.scheduled })
}

/** A deleted workspace is purged once its backup files are due too (its destinations are purged with it). */
export function workspaceGraceDays(workspaceId: string) {
  const s = workspaceSettings(workspaceId)
  const delays = Object.values(purgeDelays(workspaceId)).filter((d): d is number => d !== null)
  return s.trash_days + Math.max(0, ...delays)
}

export function softDeleteWorkspace(workspaceId: string, actor: string) {
  db().prepare('UPDATE workspace_settings SET deleted_at = ? WHERE workspace_id = ?').run(Date.now(), workspaceId)
  db().prepare('UPDATE session SET activeOrganizationId = NULL WHERE activeOrganizationId = ?').run(workspaceId)
  syncSchedules()
  audit(workspaceId, actor, 'workspace.deleted')
}

export function restoreWorkspace(workspaceId: string, actor: string) {
  db().prepare('UPDATE workspace_settings SET deleted_at = NULL WHERE workspace_id = ?').run(workspaceId)
  syncSchedules()
  audit(workspaceId, actor, 'workspace.restored')
}

export async function purgeWorkspace(workspaceId: string, actor: string) {
  // Its destinations go with it, so files can't be deleted later: pending and delayed deletions happen now.
  const { deleted: backupsDeleted } = await deleteBackups(workspaceId, 'r.workspace_id', workspaceId, true)
  const name = (db().prepare('SELECT name FROM organization WHERE id = ?').get(workspaceId) as { name: string } | undefined)?.name
  db().transaction(() => {
    for (const t of ['restores', 'runs', 'jobs', 'instances', 'destinations', 'channels', 'audit']) {
      db().prepare(`DELETE FROM ${t} WHERE workspace_id = ?`).run(workspaceId)
    }
    db().prepare('DELETE FROM workspace_settings WHERE workspace_id = ?').run(workspaceId)
    db().prepare('DELETE FROM invitation WHERE organizationId = ?').run(workspaceId)
    db().prepare('DELETE FROM member WHERE organizationId = ?').run(workspaceId)
    db().prepare('DELETE FROM organization WHERE id = ?').run(workspaceId)
  })()
  syncSchedules()
  audit(null, actor, 'workspace.purged', { id: workspaceId, name, backupsDeleted })
}

/** Purges everything whose grace period has expired. Runs hourly. */
export async function purgeExpired() {
  await deleteDueBackups().catch((err) => console.error('[purge] backups', err))
  const workspaces = db().prepare('SELECT workspace_id, trash_days, deleted_at FROM workspace_settings').all() as {
    workspace_id: string
    trash_days: number
    deleted_at: number | null
  }[]
  for (const ws of workspaces) {
    const cutoff = Date.now() - ws.trash_days * DAY
    if (ws.deleted_at && ws.deleted_at <= Date.now() - workspaceGraceDays(ws.workspace_id) * DAY) {
      await purgeWorkspace(ws.workspace_id, 'system').catch((err) => console.error('[purge] workspace', err))
      continue
    }
    for (const kind of ['job', 'instance', 'destination'] as const) {
      const expired = db()
        .prepare(`SELECT id FROM ${TABLE[kind]} WHERE workspace_id = ? AND deleted_at IS NOT NULL AND deleted_at <= ?`)
        .all(ws.workspace_id, cutoff) as { id: string }[]
      for (const { id } of expired) {
        // A job deleted together with its instance is purged with it.
        if (kind === 'job' && !db().prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)) continue
        await purgeItem(ws.workspace_id, kind, id, 'system').catch((err) => console.error(`[purge] ${kind} ${id}`, err))
      }
    }
  }
}

const g = globalThis as { __purgeTimer?: NodeJS.Timeout }

export function startPurgeLoop() {
  if (g.__purgeTimer) return
  void purgeExpired()
  const tick = () => {
    void sendDueDigests().catch((err) => console.error('[digest]', err))
    void checkStaleInstances().catch((err) => console.error('[stale]', err))
  }
  tick()
  // Hourly purge; digests and stale-backup alerts are checked every 10 minutes (digests arrive close to 08:00).
  g.__purgeTimer = setInterval(() => void purgeExpired(), 60 * 60 * 1000)
  setInterval(tick, 10 * 60 * 1000)
}

/**
 * Permanently deletes one backup run: every stored copy is removed from its destination, then the run
 * itself. Refuses while it's running or while a copy is under Object Lock. If some copies fail to
 * delete, the run is kept (with the ones that did go marked as deleted) so the operator can retry.
 */
export async function deleteRun(workspaceId: string, runId: string, actor: string) {
  const run = db().prepare('SELECT id, status, started_at FROM runs WHERE id = ? AND workspace_id = ?').get(runId, workspaceId) as
    | { id: string; status: string; started_at: number }
    | undefined
  if (!run) throw new Error('Backup not found')
  if (run.status === 'running') throw new Error('This backup is still running')
  const copies = db()
    .prepare(
      `SELECT c.run_id, c.destination_id, c.object_key, c.version_id, c.locked_until, d.name FROM run_copies c
       JOIN destinations d ON d.id = c.destination_id WHERE c.run_id = ? AND c.status = 'ok' AND c.deleted_at IS NULL`,
    )
    .all(runId) as (Copy & { name: string })[]
  const locked = copies.find((c) => c.locked_until && c.locked_until > Date.now())
  if (locked) throw new Error(`The copy on ${locked.name} is under Object Lock until ${new Date(locked.locked_until!).toISOString().slice(0, 10)}`)
  const failed: string[] = []
  for (const c of copies) {
    const dest = db().prepare('SELECT * FROM destinations WHERE id = ?').get(c.destination_id) as DestinationRow
    try {
      await openDestination(dest).delete(c.object_key, c.version_id)
      db().prepare('UPDATE run_copies SET deleted_at = ?, delete_after = NULL WHERE run_id = ? AND destination_id = ?').run(Date.now(), runId, c.destination_id)
    } catch (err) {
      failed.push(c.name)
      audit(workspaceId, actor, 'run.delete_failed', { runId, key: c.object_key, destination: c.name, error: String(err) })
    }
  }
  if (failed.length) throw new Error(`Couldn't delete the copy on ${failed.join(', ')} — the backup was kept. Check the audit log and try again.`)
  db().prepare('DELETE FROM runs WHERE id = ?').run(runId)
  audit(workspaceId, actor, 'run.deleted', { runId, startedAt: new Date(run.started_at).toISOString(), copiesDeleted: copies.length })
}

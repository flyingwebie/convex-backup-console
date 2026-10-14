import { audit, db } from './db.server'
import { syncSchedules } from './scheduler.server'
import { openDestination, type DestinationRow } from './storage.server'
import { workspaceSettings } from './workspace.server'

// Deletion policy: deleted workspaces, instances, jobs and destinations sit in the Trash for the
// workspace's `trash_days`, then are purged. `purge_backups` decides whether the backup files they
// produced are deleted from the destinations too (default: keep them).

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

/** Deletes stored backup files for runs matching `where` (used when purge_backups is on). */
async function deleteBackups(workspaceId: string, where: string, param: string) {
  const copies = db()
    .prepare(
      `SELECT c.run_id, c.destination_id, c.object_key FROM run_copies c JOIN runs r ON r.id = c.run_id
       WHERE ${where} = ? AND c.status = 'ok' AND c.deleted_at IS NULL`,
    )
    .all(param) as { run_id: string; destination_id: string; object_key: string }[]
  let deleted = 0
  for (const c of copies) {
    const dest = db().prepare('SELECT * FROM destinations WHERE id = ?').get(c.destination_id) as DestinationRow | undefined
    if (!dest) continue
    try {
      await openDestination(dest).delete(c.object_key)
      db().prepare('UPDATE run_copies SET deleted_at = ? WHERE run_id = ? AND destination_id = ?').run(Date.now(), c.run_id, c.destination_id)
      deleted++
    } catch (err) {
      audit(workspaceId, 'system', 'purge.delete_failed', { ...c, error: String(err) })
    }
  }
  return deleted
}

/** Permanently removes a trashed item, applying the workspace's backup policy. */
export async function purgeItem(workspaceId: string, kind: TrashKind, id: string, actor: string) {
  const row = db().prepare(`SELECT name, deleted_at FROM ${TABLE[kind]} WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
    | { name: string; deleted_at: number | null }
    | undefined
  if (!row?.deleted_at) throw new Error('Not in the trash')
  const { purge_backups } = workspaceSettings(workspaceId)
  let backupsDeleted = 0
  if (purge_backups && kind !== 'destination') {
    backupsDeleted = await deleteBackups(workspaceId, kind === 'job' ? 'r.job_id' : 'r.instance_id', id)
  }
  // Destination files are never touched: once its credentials are gone they can't be, and the
  // operator may still want them. run_copies rows cascade away with the destination.
  db().prepare(`DELETE FROM ${TABLE[kind]} WHERE id = ?`).run(id)
  syncSchedules()
  audit(workspaceId, actor, `${kind}.purged`, { id, name: row.name, backupsDeleted })
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
  const { purge_backups } = workspaceSettings(workspaceId)
  const backupsDeleted = purge_backups ? await deleteBackups(workspaceId, 'r.workspace_id', workspaceId) : 0
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
  const workspaces = db().prepare('SELECT workspace_id, trash_days, deleted_at FROM workspace_settings').all() as {
    workspace_id: string
    trash_days: number
    deleted_at: number | null
  }[]
  for (const ws of workspaces) {
    const cutoff = Date.now() - ws.trash_days * DAY
    if (ws.deleted_at && ws.deleted_at <= cutoff) {
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
  g.__purgeTimer = setInterval(() => void purgeExpired(), 60 * 60 * 1000)
}

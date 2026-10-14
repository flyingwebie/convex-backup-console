import { db } from './db.server'
import { workspaceSettings } from './workspace.server'

/** Backup health for a workspace: an instance is healthy if its last good backup is within stale_hours. */
export function workspaceHealth(workspaceId: string) {
  const s = workspaceSettings(workspaceId)
  const ws = db().prepare('SELECT name FROM organization WHERE id = ?').get(workspaceId) as { name: string }
  const instances = (
    db()
      .prepare(
        `SELECT i.id, i.name, i.kind,
           (SELECT MAX(started_at) FROM runs r WHERE r.instance_id = i.id AND r.status IN ('ok', 'partial')) AS last_ok_at,
           (SELECT status FROM runs r WHERE r.instance_id = i.id AND r.status != 'running' ORDER BY started_at DESC LIMIT 1) AS last_status,
           EXISTS (SELECT 1 FROM jobs j WHERE j.instance_id = i.id AND j.enabled = 1 AND j.deleted_at IS NULL) AS has_job
         FROM instances i WHERE i.workspace_id = ? AND i.deleted_at IS NULL ORDER BY i.name`,
      )
      .all(workspaceId) as { id: string; name: string; kind: string; last_ok_at: number | null; last_status: string | null; has_job: number }[]
  ).map((i) => {
    const stale = !i.last_ok_at || Date.now() - i.last_ok_at > s.stale_hours * 3_600_000
    return { name: i.name, kind: i.kind, last_good_backup: i.last_ok_at ? new Date(i.last_ok_at).toISOString() : null, last_status: i.last_status, protected: Boolean(i.has_job), healthy: !stale && Boolean(i.has_job) }
  })
  return {
    workspace: ws.name,
    healthy: instances.every((i) => i.healthy),
    stale_after_hours: s.stale_hours,
    checked_at: new Date().toISOString(),
    instances,
  }
}

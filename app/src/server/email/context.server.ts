import { COMMON_SAMPLE, EMAIL_TYPES, type EmailType } from '~/lib/email-types'
import { db } from '../db.server'
import { env } from '../env.server'
import { workspaceHealth } from '../health.server'
import { workspaceSettings } from '../workspace.server'

// Builds the template variables for each email type — from real rows (events, "real data"
// previews) or from the registry's sample data.

export function duration(ms: number | null | undefined) {
  if (ms == null || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null)

export function workspaceVars(workspaceId: string) {
  const ws = db().prepare('SELECT name FROM organization WHERE id = ?').get(workspaceId) as { name: string } | undefined
  return { name: ws?.name ?? 'Workspace', url: env.publicUrl, support_email: workspaceSettings(workspaceId).email_support ?? '' }
}

export function runVars(runId: string) {
  const r = db()
    .prepare(
      `SELECT r.*, j.name AS job_name, i.name AS instance_name, i.kind AS instance_kind FROM runs r
       LEFT JOIN jobs j ON j.id = r.job_id LEFT JOIN instances i ON i.id = r.instance_id WHERE r.id = ?`,
    )
    .get(runId) as
    | { id: string; started_at: number; finished_at: number | null; bytes: number | null; error: string | null; job_name: string | null; instance_name: string | null; instance_kind: string | null; job_id: string | null }
    | undefined
  if (!r) return null
  const copies = db()
    .prepare('SELECT d.name AS destination, c.status, c.error FROM run_copies c JOIN destinations d ON d.id = c.destination_id WHERE c.run_id = ? ORDER BY d.name')
    .all(runId) as { destination: string; status: string; error: string | null }[]
  return {
    job: { name: r.job_name ?? 'Deleted job' },
    instance: { name: r.instance_name ?? 'Deleted instance', kind: r.instance_kind === 'cloud' ? 'cloud' : 'self-hosted' },
    run: {
      started_at: iso(r.started_at),
      duration: duration(r.finished_at ? r.finished_at - r.started_at : null),
      bytes: r.bytes,
      error: r.error,
      url: `${env.publicUrl}/runs${r.job_id ? `?job=${r.job_id}` : ''}`,
      copies,
    },
  }
}

const MODE_LABEL: Record<string, string> = { replaceAll: 'Full restore', replace: 'Replace tables', append: 'Append', requireEmpty: 'Into empty tables' }

export function restoreVars(restoreId: string) {
  const r = db().prepare('SELECT * FROM restores WHERE id = ?').get(restoreId) as
    | { target_name: string; mode: string; rows_written: number | null; tables: string | null; scrubbed: number; object_key: string; error: string | null; actor: string }
    | undefined
  if (!r) return null
  const actor = db().prepare('SELECT name FROM user WHERE email = ?').get(r.actor) as { name: string } | undefined
  return {
    restore: {
      target: r.target_name,
      mode: MODE_LABEL[r.mode] ?? r.mode,
      documents: r.rows_written ?? 0,
      tables: r.tables ? (JSON.parse(r.tables) as string[]).join(', ') : '',
      scrubbed: Boolean(r.scrubbed),
      backup: r.object_key,
      error: r.error ?? '',
    },
    actor: { name: actor?.name ?? r.actor, email: r.actor },
  }
}

export function digestVars(workspaceId: string, since: number, period: 'daily' | 'weekly') {
  const health = workspaceHealth(workspaceId)
  const runs = db()
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'ok'), 0) AS ok, COALESCE(SUM(status = 'partial'), 0) AS partial, COALESCE(SUM(status = 'failed'), 0) AS failed,
         COALESCE(SUM(CASE WHEN status IN ('ok','partial') THEN bytes END), 0) AS bytes
       FROM runs WHERE workspace_id = ? AND started_at >= ?`,
    )
    .get(workspaceId, since) as { total: number; ok: number; partial: number; failed: number; bytes: number }
  const failures = db()
    .prepare(
      `SELECT COALESCE(i.name, 'Deleted instance') AS instance, COALESCE(r.error, 'Unknown error') AS error FROM runs r LEFT JOIN instances i ON i.id = r.instance_id
       WHERE r.workspace_id = ? AND r.started_at >= ? AND r.status = 'failed' ORDER BY r.started_at DESC LIMIT 10`,
    )
    .all(workspaceId, since) as { instance: string; error: string }[]
  const restores = (db().prepare('SELECT COUNT(*) AS n FROM restores WHERE workspace_id = ? AND started_at >= ?').get(workspaceId, since) as { n: number }).n
  return {
    period,
    since: new Date(since).toISOString(),
    runs,
    restores,
    healthy: health.healthy,
    instances: health.instances.map((i) => ({ name: i.name, healthy: i.healthy, last_good_backup: i.last_good_backup, protected: i.protected })),
    failures,
  }
}

/** Variables for the preview's "real data" mode: the latest matching event in the workspace, else the sample. */
export function realVars(workspaceId: string, type: EmailType): { vars: Record<string, unknown>; real: boolean } {
  const sample = { vars: EMAIL_TYPES[type].sample, real: false }
  const status: Partial<Record<EmailType, string>> = { backup_failed: 'failed', backup_partial: 'partial', backup_succeeded: 'ok' }
  if (status[type]) {
    const row = db().prepare('SELECT id FROM runs WHERE workspace_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1').get(workspaceId, status[type]) as { id: string } | undefined
    const vars = row && runVars(row.id)
    return vars ? { vars, real: true } : sample
  }
  if (type === 'restore_completed' || type === 'restore_failed') {
    const row = db()
      .prepare('SELECT id FROM restores WHERE workspace_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1')
      .get(workspaceId, type === 'restore_completed' ? 'ok' : 'failed') as { id: string } | undefined
    const vars = row && restoreVars(row.id)
    return vars ? { vars, real: true } : sample
  }
  if (type === 'digest') {
    const s = workspaceSettings(workspaceId)
    const period = s.digest === 'weekly' ? 'weekly' : 'daily'
    return { vars: digestVars(workspaceId, Date.now() - (period === 'weekly' ? 7 : 1) * 86_400_000, period), real: true }
  }
  if (type === 'backup_stale') {
    const health = workspaceHealth(workspaceId)
    const i = health.instances.find((x) => !x.healthy) ?? health.instances[0]
    return i ? { vars: { instance: { name: i.name, last_good_backup: i.last_good_backup }, stale_hours: health.stale_after_hours }, real: true } : sample
  }
  return sample
}

export function commonVars(workspaceId: string | null, recipient: { name: string; email: string }) {
  return { workspace: workspaceId ? workspaceVars(workspaceId) : { ...COMMON_SAMPLE.workspace, url: env.publicUrl }, recipient }
}

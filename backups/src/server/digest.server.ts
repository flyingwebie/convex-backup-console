import { Cron } from 'croner'
import { db } from './db.server'
import { env } from './env.server'
import { workspaceHealth } from './health.server'
import { getSmtp, sendMail } from './mail.server'
import { workspaceSettings } from './workspace.server'

const SCHEDULE = { daily: '0 8 * * *', weekly: '0 8 * * 1' } as const

function fmtBytes(n: number) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`
}

/** Builds the plain-text digest for a workspace covering the period since `since`. */
export function buildDigest(workspaceId: string, since: number) {
  const health = workspaceHealth(workspaceId)
  const runs = db()
    .prepare(
      `SELECT COUNT(*) AS total, SUM(status = 'ok') AS ok, SUM(status = 'partial') AS partial, SUM(status = 'failed') AS failed,
         COALESCE(SUM(CASE WHEN status IN ('ok','partial') THEN bytes END), 0) AS bytes
       FROM runs WHERE workspace_id = ? AND started_at >= ?`,
    )
    .get(workspaceId, since) as { total: number; ok: number | null; partial: number | null; failed: number | null; bytes: number }
  const failures = db()
    .prepare(
      `SELECT i.name, r.error, r.started_at FROM runs r LEFT JOIN instances i ON i.id = r.instance_id
       WHERE r.workspace_id = ? AND r.started_at >= ? AND r.status = 'failed' ORDER BY r.started_at DESC LIMIT 10`,
    )
    .all(workspaceId, since) as { name: string | null; error: string | null; started_at: number }[]
  const restores = (db().prepare('SELECT COUNT(*) AS n FROM restores WHERE workspace_id = ? AND started_at >= ?').get(workspaceId, since) as { n: number }).n
  const unhealthy = health.instances.filter((i) => !i.healthy)
  const subject = `${unhealthy.length ? '⚠️' : '✅'} [${health.workspace}] Backup digest: ${runs.ok ?? 0} ok, ${runs.failed ?? 0} failed`
  const text = [
    `Backup digest for ${health.workspace} since ${new Date(since).toUTCString()}`,
    '',
    `Runs: ${runs.total} (${runs.ok ?? 0} ok, ${runs.partial ?? 0} partial, ${runs.failed ?? 0} failed) · ${fmtBytes(runs.bytes)} backed up · ${restores} restore(s)`,
    '',
    'Instances:',
    ...health.instances.map(
      (i) =>
        `  ${i.healthy ? '✓' : '✗'} ${i.name} — last good backup ${i.last_good_backup ? new Date(i.last_good_backup).toUTCString() : 'never'}${i.protected ? '' : ' (no active job)'}`,
    ),
    ...(failures.length ? ['', 'Recent failures:', ...failures.map((f) => `  • ${f.name ?? 'deleted instance'}: ${f.error ?? 'unknown error'}`)] : []),
    '',
    env.publicUrl,
  ].join('\n')
  return { subject, text }
}

/** Sends digests that are due. Runs hourly with the purge loop; also callable for a test send. */
export async function sendDueDigests(now = Date.now()) {
  if (!getSmtp()) return
  const rows = db()
    .prepare("SELECT workspace_id FROM workspace_settings WHERE digest != 'off' AND deleted_at IS NULL AND digest_recipients IS NOT NULL")
    .all() as { workspace_id: string }[]
  for (const { workspace_id } of rows) {
    const s = workspaceSettings(workspace_id)
    const last = s.digest_last_sent ?? now
    if (s.digest_last_sent == null) {
      db().prepare('UPDATE workspace_settings SET digest_last_sent = ? WHERE workspace_id = ?').run(now, workspace_id)
      continue
    }
    const due = new Cron(SCHEDULE[s.digest as 'daily' | 'weekly'], { timezone: s.timezone }).nextRun(new Date(last))
    if (!due || due.getTime() > now) continue
    await sendDigest(workspace_id, last).catch((err) => console.error('[digest]', err))
    db().prepare('UPDATE workspace_settings SET digest_last_sent = ? WHERE workspace_id = ?').run(now, workspace_id)
  }
}

export async function sendDigest(workspaceId: string, since: number) {
  const s = workspaceSettings(workspaceId)
  const to = (s.digest_recipients ?? '').split(/[,\s]+/).filter(Boolean)
  if (!to.length) throw new Error('No digest recipients')
  const { subject, text } = buildDigest(workspaceId, since)
  await sendMail(to.join(', '), subject, text)
}

import { Cron } from 'croner'
import { db } from './db.server'
import { digestVars } from './email/context.server'
import { resolveRecipients, sendWorkspaceEmail, smtpFor } from './email/service.server'
import { workspaceSettings } from './workspace.server'

const SCHEDULE = { daily: '0 8 * * *', weekly: '0 8 * * 1' } as const

/** Sends digests that are due. Checked every 10 minutes from the purge loop. */
export async function sendDueDigests(now = Date.now()) {
  const rows = db().prepare("SELECT workspace_id FROM workspace_settings WHERE digest != 'off' AND deleted_at IS NULL").all() as { workspace_id: string }[]
  for (const { workspace_id } of rows) {
    if (!smtpFor(workspace_id)) continue
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
  if (!resolveRecipients(workspaceId, 'digest').length) throw new Error('The digest has no recipients — choose them on the Emails page')
  const s = workspaceSettings(workspaceId)
  return sendWorkspaceEmail(workspaceId, 'digest', digestVars(workspaceId, since, s.digest === 'weekly' ? 'weekly' : 'daily'))
}

import { EMAIL_TYPES, type EmailType } from '~/lib/email-types'
import { decrypt, encrypt } from '../crypto.server'
import { audit, db } from '../db.server'
import { getSmtp } from '../mail.server'
import { workspaceSettings } from '../workspace.server'
import { restoreVars, runVars } from './context.server'
import { routeFor, saveRoute, sendWorkspaceEmail } from './service.server'

// Domain events → emails. Each helper is fire-and-forget safe (sendWorkspaceEmail never throws).

export async function emailForRun(workspaceId: string, runId: string, status: 'ok' | 'partial' | 'failed') {
  const vars = runVars(runId)
  if (!vars) return
  const type: EmailType = status === 'ok' ? 'backup_succeeded' : status === 'partial' ? 'backup_partial' : 'backup_failed'
  await sendWorkspaceEmail(workspaceId, type, vars)
}

export async function emailForRestore(workspaceId: string, restoreId: string, ok: boolean) {
  const vars = restoreVars(restoreId)
  if (!vars) return
  await sendWorkspaceEmail(workspaceId, ok ? 'restore_completed' : 'restore_failed', vars, { actorEmail: vars.actor.email })
}

/**
 * Alerts once when a protected instance goes without a good backup for longer than the workspace's
 * threshold; re-arms when a backup succeeds again. Runs with the digest loop.
 */
export async function checkStaleInstances(now = Date.now()) {
  const rows = db()
    .prepare(
      `SELECT i.id, i.name, i.workspace_id, i.created_at, i.stale_alerted_at, s.stale_hours,
         (SELECT MAX(started_at) FROM runs r WHERE r.instance_id = i.id AND r.status IN ('ok', 'partial')) AS last_ok_at
       FROM instances i JOIN workspace_settings s ON s.workspace_id = i.workspace_id
       WHERE i.deleted_at IS NULL AND s.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM jobs j WHERE j.instance_id = i.id AND j.enabled = 1 AND j.deleted_at IS NULL)`,
    )
    .all() as { id: string; name: string; workspace_id: string; created_at: number; stale_alerted_at: number | null; stale_hours: number; last_ok_at: number | null }[]
  for (const i of rows) {
    const stale = now - (i.last_ok_at ?? i.created_at) > i.stale_hours * 3_600_000
    if (stale && !i.stale_alerted_at) {
      db().prepare('UPDATE instances SET stale_alerted_at = ? WHERE id = ?').run(now, i.id)
      await sendWorkspaceEmail(i.workspace_id, 'backup_stale', {
        instance: { name: i.name, last_good_backup: i.last_ok_at ? new Date(i.last_ok_at).toISOString() : null },
        stale_hours: i.stale_hours,
      })
    } else if (!stale && i.stale_alerted_at) {
      db().prepare('UPDATE instances SET stale_alerted_at = NULL WHERE id = ?').run(i.id)
    }
  }
}

const FAILURE_TYPES: EmailType[] = ['backup_failed', 'backup_partial', 'restore_failed']
const SUCCESS_TYPES: EmailType[] = ['backup_succeeded', 'restore_completed']

/**
 * One-time move from the old setup: "Email" alert channels become external recipients on the
 * Emails page (their SMTP becomes the workspace's own SMTP if it differs from the platform's),
 * and digest recipients move to the digest's recipients.
 */
export function migrateLegacyEmail() {
  const workspaces = db().prepare('SELECT workspace_id FROM workspace_settings WHERE emails_migrated = 0').all() as { workspace_id: string }[]
  const platform = getSmtp()
  for (const { workspace_id: ws } of workspaces) {
    db().transaction(() => {
      const addExternals = (type: EmailType, emails: string[]) => {
        if (!emails.length) return
        const r = routeFor(ws, type)
        saveRoute(ws, type, { ...r, externals: [...new Set([...r.externals, ...emails.map((e) => e.toLowerCase())])] })
      }
      const channels = db().prepare("SELECT id, name, config_enc, on_failure, on_success FROM channels WHERE workspace_id = ? AND kind = 'email'").all(ws) as {
        id: string
        name: string
        config_enc: string
        on_failure: number
        on_success: number
      }[]
      for (const c of channels) {
        const cfg = JSON.parse(decrypt(c.config_enc)) as { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string; to: string }
        const to = cfg.to.split(/[,;\s]+/).filter((e) => e.includes('@'))
        if (c.on_failure) for (const t of FAILURE_TYPES) addExternals(t, to)
        if (c.on_success) for (const t of SUCCESS_TYPES) addExternals(t, to)
        const differs = !platform || platform.host !== cfg.host || platform.port !== cfg.port || platform.user !== cfg.user
        if (differs && !workspaceSettings(ws).email_smtp_enc) {
          const { host, port, secure, user, pass, from } = cfg
          db().prepare('UPDATE workspace_settings SET email_smtp_enc = ? WHERE workspace_id = ?').run(encrypt(JSON.stringify({ host, port, secure, user, pass, from })), ws)
        }
        db().prepare('DELETE FROM channels WHERE id = ?').run(c.id)
        audit(ws, 'system', 'email.channel_migrated', { channel: c.name, to, onFailure: Boolean(c.on_failure), onSuccess: Boolean(c.on_success) })
      }
      const digest = workspaceSettings(ws).digest_recipients
      if (digest) {
        addExternals('digest', digest.split(/[,\s]+/).filter(Boolean))
        db().prepare('UPDATE workspace_settings SET digest_recipients = NULL WHERE workspace_id = ?').run(ws)
      }
      db().prepare('UPDATE workspace_settings SET emails_migrated = 1 WHERE workspace_id = ?').run(ws)
    })()
  }
}

export const DIRECT_TYPES = (Object.keys(EMAIL_TYPES) as EmailType[]).filter((t) => EMAIL_TYPES[t].direct)

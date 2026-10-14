import nodemailer from 'nodemailer'
import { EMAIL_TYPES, type EmailType, type RoleKey, type SecurityEmailType, type Structured } from '~/lib/email-types'
import { ROLE_INFO } from '~/lib/permissions'
import { decrypt } from '../crypto.server'
import { audit, db } from '../db.server'
import { env } from '../env.server'
import { getSmtp, type SmtpConfig } from '../mail.server'
import { workspaceSettings } from '../workspace.server'
import { commonVars } from './context.server'
import { emailLogo } from './logo.server'
import { renderEmail, type Branding, type Rendered, type StoredTemplate } from './render.server'

export const DEFAULT_ACCENT = '#4f46e5'
export const LOCALE = 'en'
const PLATFORM = '' // email_templates.workspace_id for platform defaults

// ── Templates ────────────────────────────────────────────────

type TemplateRow = { mode: 'structured' | 'html'; content: string; updated_by: string; updated_at: number }

function toStored(row: TemplateRow): StoredTemplate {
  const c = JSON.parse(row.content)
  return row.mode === 'html' ? { mode: 'html', subject: c.subject, html: c.html } : { mode: 'structured', content: c as Structured }
}

export function templateRow(workspaceId: string | null, type: EmailType) {
  return db()
    .prepare('SELECT mode, content, updated_by, updated_at FROM email_templates WHERE workspace_id = ? AND type = ? AND locale = ?')
    .get(workspaceId ?? PLATFORM, type, LOCALE) as TemplateRow | undefined
}

/** Platform default (if a platform admin edited it) or the built-in default. */
export function defaultTemplate(type: EmailType): { template: StoredTemplate; source: 'platform' | 'builtin' } {
  const row = templateRow(null, type)
  return row ? { template: toStored(row), source: 'platform' } : { template: { mode: 'structured', content: EMAIL_TYPES[type].defaults }, source: 'builtin' }
}

/** What a workspace actually sends: its override, else the default. */
export function effectiveTemplate(workspaceId: string, type: EmailType): { template: StoredTemplate; source: 'workspace' | 'platform' | 'builtin'; updated_by?: string; updated_at?: number } {
  const row = templateRow(workspaceId, type)
  return row ? { template: toStored(row), source: 'workspace', updated_by: row.updated_by, updated_at: row.updated_at } : defaultTemplate(type)
}

const KEEP_VERSIONS = 20

function serialize(t: StoredTemplate) {
  return { mode: t.mode, content: JSON.stringify(t.mode === 'html' ? { subject: t.subject, html: t.html } : t.content) }
}

/** Saves a template (null = remove the override) and records it in the version history. */
export function writeTemplate(workspaceId: string | null, type: EmailType, t: StoredTemplate | null, actor: string, note?: string) {
  const ws = workspaceId ?? PLATFORM
  db().transaction(() => {
    if (t) {
      const { mode, content } = serialize(t)
      db()
        .prepare(
          `INSERT INTO email_templates (workspace_id, type, locale, mode, content, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, type, locale) DO UPDATE SET mode = excluded.mode, content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        )
        .run(ws, type, LOCALE, mode, content, actor, Date.now())
    } else {
      db().prepare('DELETE FROM email_templates WHERE workspace_id = ? AND type = ? AND locale = ?').run(ws, type, LOCALE)
    }
    const stored = t ?? (workspaceId ? defaultTemplate(type).template : { mode: 'structured' as const, content: EMAIL_TYPES[type].defaults })
    const { mode, content } = serialize(stored)
    db()
      .prepare('INSERT INTO email_template_versions (workspace_id, type, locale, mode, content, saved_by, saved_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ws, type, LOCALE, mode, content, actor, Date.now(), note ?? (t ? null : 'Reset to default'))
    db()
      .prepare(
        `DELETE FROM email_template_versions WHERE workspace_id = ? AND type = ? AND locale = ? AND id NOT IN
           (SELECT id FROM email_template_versions WHERE workspace_id = ? AND type = ? AND locale = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(ws, type, LOCALE, ws, type, LOCALE, KEEP_VERSIONS)
  })()
}

export function templateVersions(workspaceId: string | null, type: EmailType) {
  return (
    db()
      .prepare('SELECT id, mode, content, saved_by, saved_at, note FROM email_template_versions WHERE workspace_id = ? AND type = ? AND locale = ? ORDER BY id DESC')
      .all(workspaceId ?? PLATFORM, type, LOCALE) as (TemplateRow & { id: number; saved_by: string; saved_at: number; note: string | null })[]
  ).map((v) => ({ id: v.id, saved_by: v.saved_by, saved_at: v.saved_at, note: v.note, template: toStored(v) }))
}

// ── Branding & SMTP ──────────────────────────────────────────

export function branding(workspaceId: string | null): Branding & { senderName: string | null; replyTo: string | null } {
  if (!workspaceId) {
    return { name: 'Convex Backup Console', hasLogo: false, accent: DEFAULT_ACCENT, footer: null, supportEmail: null, hidePoweredBy: false, consoleUrl: env.publicUrl, timezone: 'UTC', senderName: null, replyTo: null }
  }
  const s = workspaceSettings(workspaceId)
  const ws = db().prepare('SELECT name, logo FROM organization WHERE id = ?').get(workspaceId) as { name: string; logo: string | null } | undefined
  return {
    name: ws?.name ?? 'Workspace',
    hasLogo: Boolean(ws?.logo),
    accent: s.email_accent ?? DEFAULT_ACCENT,
    footer: s.email_footer,
    supportEmail: s.email_support,
    hidePoweredBy: Boolean(s.email_hide_powered),
    consoleUrl: env.publicUrl,
    timezone: s.timezone,
    senderName: s.email_sender_name,
    replyTo: s.email_reply_to,
  }
}

export function workspaceSmtp(workspaceId: string): SmtpConfig | null {
  const enc = workspaceSettings(workspaceId).email_smtp_enc
  return enc ? (JSON.parse(decrypt(enc)) as SmtpConfig) : null
}

/** The SMTP server a workspace sends through: its own, else the platform's. */
export function smtpFor(workspaceId: string | null) {
  return (workspaceId && workspaceSmtp(workspaceId)) || getSmtp()
}

function fromAddress(cfg: SmtpConfig, senderName: string | null) {
  if (!senderName) return cfg.from
  const address = cfg.from.match(/<([^>]+)>/)?.[1] ?? cfg.from.trim()
  return { name: senderName, address }
}

export async function deliver(cfg: SmtpConfig, msg: { to: string; rendered: Rendered; logo: Buffer | null; senderName: string | null; replyTo: string | null }) {
  const transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined })
  await transport.sendMail({
    from: fromAddress(cfg, msg.senderName),
    replyTo: msg.replyTo ?? undefined,
    to: msg.to,
    subject: msg.rendered.subject,
    html: msg.rendered.html,
    text: msg.rendered.text,
    attachments: msg.logo && msg.rendered.html.includes('cid:logo') ? [{ filename: 'logo.png', content: msg.logo, cid: 'logo', contentType: 'image/png' }] : [],
  })
}

/** Renders with the given template, falling back to the default when a custom template breaks. */
export async function renderWithFallback(workspaceId: string, type: EmailType, vars: Record<string, unknown>, b: Branding) {
  const eff = effectiveTemplate(workspaceId, type)
  try {
    return await renderEmail(type, eff.template, b, vars)
  } catch (err) {
    if (eff.source === 'builtin') throw err
    audit(workspaceId, 'system', 'email.template_fallback', { type, source: eff.source, error: err instanceof Error ? err.message : String(err) })
    return renderEmail(type, { mode: 'structured', content: EMAIL_TYPES[type].defaults }, b, vars)
  }
}

// ── Recipients ───────────────────────────────────────────────

export type Route = { enabled: boolean; roles: RoleKey[]; members: string[]; externals: string[]; actor: boolean }

export function routeFor(workspaceId: string, type: EmailType): Route {
  const row = db().prepare('SELECT * FROM email_routes WHERE workspace_id = ? AND type = ?').get(workspaceId, type) as
    | { enabled: number; roles: string; members: string; externals: string; actor: number }
    | undefined
  if (!row) {
    const d = EMAIL_TYPES[type].defaultRoute
    return { enabled: true, roles: d.roles, members: [], externals: [], actor: d.actor }
  }
  return { enabled: Boolean(row.enabled), roles: JSON.parse(row.roles), members: JSON.parse(row.members), externals: JSON.parse(row.externals), actor: Boolean(row.actor) }
}

export function saveRoute(workspaceId: string, type: EmailType, r: Route) {
  db()
    .prepare(
      `INSERT INTO email_routes (workspace_id, type, enabled, roles, members, externals, actor) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, type) DO UPDATE SET enabled = excluded.enabled, roles = excluded.roles, members = excluded.members, externals = excluded.externals, actor = excluded.actor`,
    )
    .run(workspaceId, type, r.enabled ? 1 : 0, JSON.stringify(r.roles), JSON.stringify(r.members), JSON.stringify(r.externals), r.actor ? 1 : 0)
}

type Recipient = { email: string; name: string; userId: string | null }

/** Who gets an email of `type` in a workspace: roles + chosen members + external addresses + the actor, minus opt-outs. */
export function resolveRecipients(workspaceId: string, type: EmailType, actorEmail?: string | null): Recipient[] {
  const route = routeFor(workspaceId, type)
  if (!route.enabled) return []
  const members = db()
    .prepare('SELECT u.id, u.email, u.name, m.role FROM member m JOIN user u ON u.id = m.userId WHERE m.organizationId = ?')
    .all(workspaceId) as { id: string; email: string; name: string; role: string }[]
  const out = new Map<string, Recipient>()
  const add = (r: Recipient) => {
    const key = r.email.toLowerCase()
    if (!out.has(key) || (r.userId && !out.get(key)!.userId)) out.set(key, r)
  }
  for (const m of members) if (route.roles.includes(m.role as RoleKey) || route.members.includes(m.id)) add({ email: m.email, name: m.name, userId: m.id })
  if (route.actor && EMAIL_TYPES[type].hasActor && actorEmail) {
    const u = db().prepare('SELECT id, email, name FROM user WHERE lower(email) = lower(?)').get(actorEmail) as { id: string; email: string; name: string } | undefined
    add(u ? { email: u.email, name: u.name, userId: u.id } : { email: actorEmail, name: '', userId: null })
  }
  for (const e of route.externals) {
    const member = members.find((m) => m.email.toLowerCase() === e.toLowerCase())
    add(member ? { email: member.email, name: member.name, userId: member.id } : { email: e, name: '', userId: null })
  }
  const optedOut = new Set(
    (db().prepare('SELECT user_id FROM email_optouts WHERE workspace_id = ? AND type = ?').all(workspaceId, type) as { user_id: string }[]).map((r) => r.user_id),
  )
  return [...out.values()].filter((r) => !r.userId || !optedOut.has(r.userId))
}

// ── Sending ──────────────────────────────────────────────────

/**
 * Sends a workspace email. Routed types go to the workspace's recipients for that type; direct
 * types (invitation, role changes) go to `to`. Never throws — failures are audited.
 */
export async function sendWorkspaceEmail(
  workspaceId: string,
  type: EmailType,
  vars: Record<string, unknown>,
  opts: { actorEmail?: string | null; to?: { email: string; name?: string } } = {},
) {
  try {
    const cfg = smtpFor(workspaceId)
    if (!cfg) return { sent: 0 }
    let recipients: Recipient[]
    if (EMAIL_TYPES[type].direct) {
      if (!opts.to || !routeFor(workspaceId, type).enabled) return { sent: 0 }
      recipients = [{ email: opts.to.email, name: opts.to.name ?? '', userId: null }]
    } else {
      recipients = resolveRecipients(workspaceId, type, opts.actorEmail)
    }
    if (!recipients.length) return { sent: 0 }
    const b = branding(workspaceId)
    const logo = b.hasLogo ? await emailLogo(workspaceId) : null
    const brand = { ...b, hasLogo: Boolean(logo) }
    let sent = 0
    for (const r of recipients) {
      try {
        const rendered = await renderWithFallback(workspaceId, type, { ...commonVars(workspaceId, { name: r.name || r.email.split('@')[0], email: r.email }), ...vars }, brand)
        await deliver(cfg, { to: r.email, rendered, logo, senderName: b.senderName, replyTo: b.replyTo })
        sent++
      } catch (err) {
        audit(workspaceId, 'system', 'email.failed', { type, to: r.email, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { sent }
  } catch (err) {
    audit(workspaceId, 'system', 'email.failed', { type, error: err instanceof Error ? err.message : String(err) })
    return { sent: 0 }
  }
}

// ── Security emails (fixed, always sent, platform branding) ──

const SECURITY: Record<SecurityEmailType, Structured> = {
  password_changed: {
    subject: 'Your Convex Backup Console password was changed',
    preheader: 'If this was you, there is nothing to do.',
    heading: 'Your password was changed',
    body: 'The password for **{{ recipient.email }}** was changed on {{ at | date: "%-d %B %Y at %H:%M %Z" }}.\n\nIf this wasn\'t you, ask a platform admin to reset your account immediately.',
    buttonLabel: 'Open the console',
    buttonUrl: '{{ workspace.url }}',
    showDetails: false,
  },
  passkey_added: {
    subject: 'A passkey was added to your account',
    preheader: 'A new passkey can now sign in as you.',
    heading: 'New passkey added',
    body: 'A passkey{% if passkey %} named **{{ passkey }}**{% endif %} was added to **{{ recipient.email }}** on {{ at | date: "%-d %B %Y at %H:%M %Z" }}.\n\nIf this wasn\'t you, remove it from your Account page and ask a platform admin to reset your second factors.',
    buttonLabel: 'Review your account',
    buttonUrl: '{{ workspace.url }}/account',
    showDetails: false,
  },
  two_factor_reset: {
    subject: 'Your second factors were reset',
    preheader: 'Set up an authenticator app or passkey at your next sign-in.',
    heading: 'Your two-factor authentication was reset',
    body: '{{ actor }} reset the authenticator app and passkeys on **{{ recipient.email }}** and signed you out everywhere.\n\nYou\'ll be asked to set up a new second factor the next time you sign in.',
    buttonLabel: 'Sign in',
    buttonUrl: '{{ workspace.url }}/login',
    showDetails: false,
  },
}

export async function sendSecurityEmail(type: SecurityEmailType, user: { email: string; name: string }, vars: Record<string, unknown> = {}) {
  const cfg = getSmtp()
  if (!cfg) return
  try {
    const rendered = await renderEmail(type, { mode: 'structured', content: SECURITY[type] }, branding(null), {
      ...commonVars(null, { name: user.name, email: user.email }),
      workspace: { name: 'Convex Backup Console', url: env.publicUrl, support_email: '' },
      at: new Date().toISOString(),
      ...vars,
    })
    await deliver(cfg, { to: user.email, rendered, logo: null, senderName: null, replyTo: null })
  } catch (err) {
    audit(null, 'system', 'email.failed', { type, to: user.email, error: err instanceof Error ? err.message : String(err) })
  }
}

export const roleLabel = (r: string) => ROLE_INFO[r as keyof typeof ROLE_INFO]?.label ?? r

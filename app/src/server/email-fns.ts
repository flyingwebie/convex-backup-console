import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { COMMON_SAMPLE, COMMON_VARIABLES, EMAIL_TYPES, EMAIL_TYPE_KEYS, type EmailType } from '~/lib/email-types'
import { can, ROLES } from '~/lib/permissions'
import { encrypt } from './crypto.server'
import { audit, db } from './db.server'
import { commonVars, realVars } from './email/context.server'
import { emailLogo } from './email/logo.server'
import { exportDesignAsHtml, renderEmail, sanitizeEmailHtml, unknownVariables, validateTemplate, type StoredTemplate } from './email/render.server'
import {
  branding,
  defaultTemplate,
  deliver,
  effectiveTemplate,
  resolveRecipients,
  routeFor,
  saveRoute,
  smtpFor,
  templateVersions,
  workspaceSmtp,
  writeTemplate,
} from './email/service.server'
import { getSmtp, type SmtpConfig } from './mail.server'
import { requirePlatformAdmin, requireWorkspace, workspaceSettings } from './workspace.server'

const parse =
  <T extends z.ZodType>(schema: T) =>
  (data: unknown) =>
    schema.parse(data) as z.infer<T>

const emailType = z.enum(EMAIL_TYPE_KEYS as [EmailType, ...EmailType[]])
const scope = z.enum(['workspace', 'platform']).default('workspace')
const field = (max: number) => z.string().max(max)
const structured = z.object({
  subject: field(300).min(1, 'Subject is required'),
  preheader: field(300),
  heading: field(300),
  body: field(20_000),
  buttonLabel: field(80),
  buttonUrl: field(500),
  showDetails: z.boolean(),
})
const template = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('structured'), content: structured }),
  z.object({ mode: z.literal('html'), subject: field(300).min(1, 'Subject is required'), html: field(200_000).min(1, 'HTML is required') }),
])

/** Resolves who's editing: a workspace member with `emails`, or a platform admin editing defaults. */
async function editor(s: 'workspace' | 'platform') {
  if (s === 'platform') {
    const ctx = await requirePlatformAdmin()
    return { workspaceId: null, user: ctx.user, canHtml: false, isOwner: false }
  }
  const ctx = await requireWorkspace('emails')
  return { workspaceId: ctx.ws.id, user: ctx.user, canHtml: can(ctx.ws.role, 'emailsAdvanced'), isOwner: can(ctx.ws.role, 'emailsAdvanced') }
}

function variablesFor(type: EmailType) {
  return [...COMMON_VARIABLES, ...EMAIL_TYPES[type].variables]
}

function routeSummary(workspaceId: string, type: EmailType) {
  const r = routeFor(workspaceId, type)
  return { ...r, count: EMAIL_TYPES[type].direct ? null : resolveRecipients(workspaceId, type).length }
}

// ── Overview ─────────────────────────────────────────────────

export const getEmails = createServerFn({ method: 'GET' }).handler(async () => {
  const ctx = await requireWorkspace('view')
  const ws = ctx.ws.id
  const s = workspaceSettings(ws)
  const ownSmtp = workspaceSmtp(ws)
  const manage = can(ctx.ws.role, 'emails')
  const members = db()
    .prepare('SELECT m.id, m.role, u.name, u.email FROM member m JOIN user u ON u.id = m.userId WHERE m.organizationId = ? ORDER BY u.email')
    .all(ws) as { id: string; role: string; name: string; email: string }[]
  return {
    canManage: manage,
    canAdvanced: can(ctx.ws.role, 'emailsAdvanced'),
    types: EMAIL_TYPE_KEYS.map((type) => {
      const def = EMAIL_TYPES[type]
      const eff = effectiveTemplate(ws, type)
      return {
        type,
        label: def.label,
        group: def.group,
        description: def.description,
        direct: Boolean(def.direct),
        hasActor: def.hasActor,
        source: eff.source,
        mode: eff.template.mode,
        updated_by: eff.updated_by ?? null,
        updated_at: eff.updated_at ?? null,
        route: manage ? routeSummary(ws, type) : null,
      }
    }),
    members: manage ? members : [],
    branding: {
      accent: s.email_accent,
      footer: s.email_footer ?? '',
      supportEmail: s.email_support ?? '',
      hidePoweredBy: Boolean(s.email_hide_powered),
      senderName: s.email_sender_name ?? '',
      replyTo: s.email_reply_to ?? '',
    },
    smtp: {
      platform: Boolean(getSmtp()),
      platformFrom: getSmtp()?.from ?? null,
      own: ownSmtp && can(ctx.ws.role, 'emailsAdvanced') ? { ...ownSmtp, pass: ownSmtp.pass ? '••••••••' : '' } : null,
      hasOwn: Boolean(ownSmtp),
    },
  }
})

// ── Template editor ──────────────────────────────────────────

export const getEmailTemplate = createServerFn({ method: 'GET' })
  .validator(parse(z.object({ type: emailType, scope })))
  .handler(async ({ data }) => {
    const e = await editor(data.scope)
    const def = EMAIL_TYPES[data.type]
    const current = e.workspaceId ? effectiveTemplate(e.workspaceId, data.type) : defaultTemplate(data.type)
    const fallback = e.workspaceId ? defaultTemplate(data.type).template : { mode: 'structured' as const, content: def.defaults }
    return {
      type: data.type,
      scope: data.scope,
      label: def.label,
      description: def.description,
      group: def.group,
      variables: variablesFor(data.type),
      source: current.source,
      template: current.template,
      defaultTemplate: fallback,
      canHtml: e.canHtml,
      versions: templateVersions(e.workspaceId, data.type).map((v) => ({ ...v, template: v.template })),
      hasRealData: Boolean(e.workspaceId),
    }
  })

export const previewEmail = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ type: emailType, scope, template, data: z.enum(['sample', 'real']).default('sample') })))
  .handler(async ({ data }) => {
    const e = await editor(data.scope)
    const t = data.template as StoredTemplate
    const fields = t.mode === 'html' ? [t.subject, t.html] : Object.values(t.content).filter((v): v is string => typeof v === 'string')
    const warnings = unknownVariables(data.type, fields).map((v) => `Unknown variable: ${v}`)
    const b = branding(e.workspaceId)
    const logo = e.workspaceId && b.hasLogo ? await emailLogo(e.workspaceId) : null
    const real = data.data === 'real' && e.workspaceId ? realVars(e.workspaceId, data.type) : { vars: EMAIL_TYPES[data.type].sample, real: false }
    if (data.data === 'real' && !real.real) warnings.push('No matching event yet — showing sample data')
    const vars = { ...(e.workspaceId ? commonVars(e.workspaceId, { name: e.user.name, email: e.user.email }) : COMMON_SAMPLE), ...real.vars }
    try {
      const out = await renderEmail(data.type, t, { ...b, hasLogo: Boolean(logo) }, vars)
      const html = logo ? out.html.replaceAll('cid:logo', `data:image/png;base64,${logo.toString('base64')}`) : out.html
      return { ok: true as const, subject: out.subject, html, text: out.text, warnings }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err), warnings }
    }
  })

function checkMode(t: StoredTemplate, canHtml: boolean) {
  if (t.mode === 'html' && !canHtml) throw new Error('Only workspace owners can use full HTML templates')
}

export const saveEmailTemplate = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ type: emailType, scope, template })))
  .handler(async ({ data }) => {
    const e = await editor(data.scope)
    let t = data.template as StoredTemplate
    checkMode(t, e.canHtml)
    validateTemplate(data.type, t)
    if (t.mode === 'html') t = { ...t, html: sanitizeEmailHtml(t.html) }
    writeTemplate(e.workspaceId, data.type, t, e.user.email)
    audit(e.workspaceId, e.user.email, data.scope === 'platform' ? 'platform.email_template_updated' : 'email.template_updated', { type: data.type, mode: t.mode })
  })

export const resetEmailTemplate = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ type: emailType, scope })))
  .handler(async ({ data }) => {
    const e = await editor(data.scope)
    writeTemplate(e.workspaceId, data.type, null, e.user.email)
    audit(e.workspaceId, e.user.email, data.scope === 'platform' ? 'platform.email_template_reset' : 'email.template_reset', { type: data.type })
  })

export const revertEmailTemplate = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ type: emailType, scope, versionId: z.number().int() })))
  .handler(async ({ data }) => {
    const e = await editor(data.scope)
    const v = templateVersions(e.workspaceId, data.type).find((x) => x.id === data.versionId)
    if (!v) throw new Error('Version not found')
    checkMode(v.template, e.canHtml)
    writeTemplate(e.workspaceId, data.type, v.template, e.user.email, `Reverted to version from ${new Date(v.saved_at).toISOString()}`)
    audit(e.workspaceId, e.user.email, 'email.template_reverted', { type: data.type, versionId: data.versionId })
  })

/** "Start from current design": the structured template rendered to editable HTML (owners only). */
export const exportTemplateHtml = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ type: emailType, content: structured })))
  .handler(async ({ data }) => {
    const e = await editor('workspace')
    if (!e.canHtml) throw new Error('Only workspace owners can use full HTML templates')
    return { html: await exportDesignAsHtml(data.type, data.content, branding(e.workspaceId)) }
  })

export const sendTestEmail = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ type: emailType, scope, template, data: z.enum(['sample', 'real']).default('sample') })))
  .handler(async ({ data }) => {
    const e = await editor(data.scope)
    const cfg = smtpFor(e.workspaceId)
    if (!cfg) throw new Error('No SMTP server is configured')
    const t = data.template as StoredTemplate
    checkMode(t, e.canHtml)
    validateTemplate(data.type, t)
    const b = branding(e.workspaceId)
    const logo = e.workspaceId && b.hasLogo ? await emailLogo(e.workspaceId) : null
    const real = data.data === 'real' && e.workspaceId ? realVars(e.workspaceId, data.type).vars : EMAIL_TYPES[data.type].sample
    const vars = { ...(e.workspaceId ? commonVars(e.workspaceId, { name: e.user.name, email: e.user.email }) : COMMON_SAMPLE), ...real }
    const out = await renderEmail(data.type, t.mode === 'html' ? { ...t, html: sanitizeEmailHtml(t.html) } : t, { ...b, hasLogo: Boolean(logo) }, vars)
    await deliver(cfg, { to: e.user.email, rendered: { ...out, subject: `[Test] ${out.subject}` }, logo, senderName: b.senderName, replyTo: b.replyTo })
    audit(e.workspaceId, e.user.email, 'email.test_sent', { type: data.type })
    return { to: e.user.email }
  })

// ── Recipients ───────────────────────────────────────────────

export const saveEmailRoute = createServerFn({ method: 'POST' })
  .validator(
    parse(
      z.object({
        type: emailType,
        enabled: z.boolean(),
        roles: z.array(z.enum(ROLES)),
        members: z.array(z.string()).max(200),
        externals: z.array(z.email().transform((e) => e.toLowerCase())).max(50),
        actor: z.boolean(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const ctx = await requireWorkspace('emails')
    const { type, ...route } = data
    const def = EMAIL_TYPES[type]
    const valid = new Set((db().prepare('SELECT id FROM member WHERE organizationId = ?').all(ctx.ws.id) as { id: string }[]).map((m) => m.id))
    saveRoute(ctx.ws.id, type, def.direct ? { ...routeFor(ctx.ws.id, type), enabled: route.enabled } : { ...route, members: route.members.filter((m) => valid.has(m)), actor: def.hasActor && route.actor })
    audit(ctx.ws.id, ctx.user.email, 'email.recipients_updated', data)
    return routeSummary(ctx.ws.id, type)
  })

// ── Branding & sending ───────────────────────────────────────

export const saveEmailBranding = createServerFn({ method: 'POST' })
  .validator(
    parse(
      z.object({
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #4f46e5').nullable(),
        footer: z.string().trim().max(500),
        supportEmail: z.union([z.literal(''), z.email()]),
        hidePoweredBy: z.boolean(),
        senderName: z.string().trim().max(80).refine((v) => !/[<>"\r\n]/.test(v), 'No quotes or angle brackets'),
        replyTo: z.union([z.literal(''), z.email()]),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const ctx = await requireWorkspace('emails')
    db()
      .prepare(
        `UPDATE workspace_settings SET email_accent = ?, email_footer = ?, email_support = ?, email_hide_powered = ?, email_sender_name = ?, email_reply_to = ?
         WHERE workspace_id = ?`,
      )
      .run(data.accent, data.footer || null, data.supportEmail || null, data.hidePoweredBy ? 1 : 0, data.senderName || null, data.replyTo || null, ctx.ws.id)
    audit(ctx.ws.id, ctx.user.email, 'email.branding_updated', data)
  })

const smtpInput = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  user: z.string().trim().optional(),
  pass: z.string().optional(),
  from: z.string().trim().min(3),
})

export const saveWorkspaceSmtp = createServerFn({ method: 'POST' })
  .validator(parse(smtpInput.nullable()))
  .handler(async ({ data }) => {
    const ctx = await requireWorkspace('emailsAdvanced')
    const cfg: SmtpConfig | null = data ? { ...data, pass: data.pass === '••••••••' ? workspaceSmtp(ctx.ws.id)?.pass : data.pass } : null
    db().prepare('UPDATE workspace_settings SET email_smtp_enc = ? WHERE workspace_id = ?').run(cfg ? encrypt(JSON.stringify(cfg)) : null, ctx.ws.id)
    audit(ctx.ws.id, ctx.user.email, cfg ? 'email.smtp_updated' : 'email.smtp_removed', cfg ? { host: cfg.host, port: cfg.port, from: cfg.from } : undefined)
  })

export const testWorkspaceSmtp = createServerFn({ method: 'POST' }).handler(async () => {
  const ctx = await requireWorkspace('emails')
  const cfg = smtpFor(ctx.ws.id)
  if (!cfg) throw new Error('No SMTP server is configured')
  const b = branding(ctx.ws.id)
  const logo = b.hasLogo ? await emailLogo(ctx.ws.id) : null
  const out = await renderEmail(
    'backup_succeeded',
    {
      mode: 'structured',
      content: { subject: `SMTP test from ${b.name}`, preheader: 'Your email settings work.', heading: 'Email is set up', body: 'This test was sent with the **{{ workspace.name }}** sender settings.', buttonLabel: 'Open the console', buttonUrl: '{{ workspace.url }}', showDetails: false },
    },
    { ...b, hasLogo: Boolean(logo) },
    commonVars(ctx.ws.id, { name: ctx.user.name, email: ctx.user.email }),
  )
  await deliver(cfg, { to: ctx.user.email, rendered: out, logo, senderName: b.senderName, replyTo: b.replyTo })
  return { to: ctx.user.email, via: workspaceSmtp(ctx.ws.id) ? 'workspace' : 'platform' }
})

// ── Platform defaults ────────────────────────────────────────

export const getPlatformEmails = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePlatformAdmin()
  return {
    types: EMAIL_TYPE_KEYS.map((type) => ({ type, label: EMAIL_TYPES[type].label, group: EMAIL_TYPES[type].group, description: EMAIL_TYPES[type].description, source: defaultTemplate(type).source })),
  }
})

// ── Personal preferences ─────────────────────────────────────

export const getEmailPreferences = createServerFn({ method: 'GET' }).handler(async () => {
  const ctx = await requireWorkspace('view')
  const optouts = db().prepare('SELECT workspace_id, type FROM email_optouts WHERE user_id = ?').all(ctx.user.id) as { workspace_id: string; type: string }[]
  return {
    workspaces: ctx.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      types: EMAIL_TYPE_KEYS.filter((t) => !EMAIL_TYPES[t].direct).map((t) => ({
        type: t,
        label: EMAIL_TYPES[t].label,
        receives: resolveRecipientsIgnoringOptOut(w.id, t, ctx.user.id),
        optedOut: optouts.some((o) => o.workspace_id === w.id && o.type === t),
      })),
    })),
  }
})

/** Whether the workspace's recipients for `type` include this user (before their opt-out). */
function resolveRecipientsIgnoringOptOut(workspaceId: string, type: EmailType, userId: string) {
  const r = routeFor(workspaceId, type)
  if (!r.enabled) return false
  const m = db().prepare('SELECT m.id, m.role, u.email FROM member m JOIN user u ON u.id = m.userId WHERE m.organizationId = ? AND m.userId = ?').get(workspaceId, userId) as
    | { id: string; role: string; email: string }
    | undefined
  if (!m) return false
  return r.roles.includes(m.role as never) || r.members.includes(m.id) || r.externals.includes(m.email.toLowerCase()) || (r.actor && EMAIL_TYPES[type].hasActor)
}

export const setEmailOptOut = createServerFn({ method: 'POST' })
  .validator(parse(z.object({ workspaceId: z.string(), type: emailType, optOut: z.boolean() })))
  .handler(async ({ data }) => {
    const ctx = await requireWorkspace('view')
    if (!ctx.workspaces.some((w) => w.id === data.workspaceId)) throw new Error('Not a member of that workspace')
    if (EMAIL_TYPES[data.type].direct) throw new Error('This email cannot be turned off')
    if (data.optOut) db().prepare('INSERT OR IGNORE INTO email_optouts (user_id, workspace_id, type) VALUES (?, ?, ?)').run(ctx.user.id, data.workspaceId, data.type)
    else db().prepare('DELETE FROM email_optouts WHERE user_id = ? AND workspace_id = ? AND type = ?').run(ctx.user.id, data.workspaceId, data.type)
    audit(data.workspaceId, ctx.user.email, data.optOut ? 'email.opted_out' : 'email.opted_in', { type: data.type })
  })


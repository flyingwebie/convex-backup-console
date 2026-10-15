import { Body, Button, Container, Head, Heading, Html, Img, Link, Preview, Section, Text } from '@react-email/components'
import { render, toPlainText } from '@react-email/render'
import { Liquid } from 'liquidjs'
import { marked } from 'marked'
import type { ReactNode } from 'react'
import sanitizeHtml from 'sanitize-html'
import { COMMON_VARIABLES, EMAIL_TYPES, type EmailType, type SecurityEmailType, type Structured } from '~/lib/email-types'

type AnyType = EmailType | SecurityEmailType

export type Branding = {
  name: string
  /** Inline PNG logo (attached as cid:logo) — null shows initials. */
  hasLogo: boolean
  accent: string
  footer: string | null
  supportEmail: string | null
  hidePoweredBy: boolean
  consoleUrl: string
  timezone: string
}

export type StoredTemplate = { mode: 'structured'; content: Structured } | { mode: 'html'; subject: string; html: string }

export type Rendered = { subject: string; html: string; text: string }

function fmtBytes(n: unknown) {
  let v = Number(n)
  if (!Number.isFinite(v)) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (v >= 1024 && i < u.length - 1) (v /= 1024), i++
  return `${v.toFixed(i && v < 10 ? 1 : 0)} ${u[i]}`
}

function engine(timezone: string, escape: boolean) {
  const e = new Liquid({ outputEscape: escape ? 'escape' : undefined, ownPropertyOnly: true, timezoneOffset: timezone, strictFilters: true })
  e.registerFilter('bytes', fmtBytes)
  return e
}

/** Variables a template references that aren't documented for its type (loop locals are ignored). */
export function unknownVariables(type: EmailType, sources: string[]): string[] {
  const known = new Set([...COMMON_VARIABLES, ...EMAIL_TYPES[type].variables].map((v) => v.name))
  const roots = new Set([...known].map((k) => k.split('.')[0]))
  const e = engine('UTC', false)
  const bad = new Set<string>()
  for (const src of sources) {
    for (const v of e.globalFullVariablesSync(src)) {
      const clean = v.replace(/\[\d+\]/g, '')
      const ok = known.has(clean) || [...known].some((k) => clean.startsWith(`${k}.`)) || (roots.has(clean) && [...known].some((k) => k.startsWith(`${clean}.`)))
      if (!ok) bad.add(v)
    }
  }
  return [...bad]
}

/** Throws a readable error if any template field doesn't parse. */
export function validateTemplate(type: EmailType, t: StoredTemplate) {
  const e = engine('UTC', false)
  const fields = t.mode === 'html' ? { subject: t.subject, html: t.html } : (t.content as Record<string, unknown>)
  for (const [name, src] of Object.entries(fields)) {
    if (typeof src !== 'string') continue
    try {
      e.parse(src)
    } catch (err) {
      throw new Error(`${name}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    }
  }
  const unknown = unknownVariables(type, Object.values(fields).filter((v): v is string => typeof v === 'string'))
  if (unknown.length) throw new Error(`Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`)
}

const EMAIL_HTML_ALLOW: sanitizeHtml.IOptions = {
  allowedTags: [
    'html', 'head', 'body', 'meta', 'title', 'style', 'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's',
    'small', 'sup', 'sub', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'center', 'font', 'center',
  ],
  allowedAttributes: {
    '*': ['style', 'class', 'align', 'valign', 'width', 'height', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'role', 'dir', 'lang', 'title', 'color'],
    a: ['href', 'target', 'rel', 'style', 'class'],
    img: ['src', 'alt', 'width', 'height', 'style', 'class'],
    meta: ['name', 'content', 'charset', 'http-equiv'],
    td: ['colspan', 'rowspan', 'style', 'class', 'align', 'valign', 'width', 'height', 'bgcolor'],
    th: ['colspan', 'rowspan', 'style', 'class', 'align', 'valign', 'width', 'height', 'bgcolor'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'cid', 'data'],
  allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
  allowVulnerableTags: true, // <style> is needed for email CSS; scripts/iframes/forms are still removed
  parseStyleAttributes: false,
}

/** Removes scripts, forms, iframes and event handlers from owner-written HTML. */
export function sanitizeEmailHtml(html: string) {
  const hasDoctype = /^\s*<!doctype/i.test(html)
  const clean = sanitizeHtml(html, EMAIL_HTML_ALLOW)
  return hasDoctype ? `<!DOCTYPE html>${clean}` : clean
}

const MD_ALLOW: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h3', 'h4'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
}

const colors = { text: '#0f172a', muted: '#64748b', border: '#e2e8f0', bg: '#f4f5f7' }

function Layout({ b, preheader, children }: { b: Branding; preheader: string; children: ReactNode }) {
  const initials = b.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <Html lang="en">
      <Head />
      <Preview>{preheader}</Preview>
      <Body style={{ backgroundColor: colors.bg, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', margin: 0, padding: '32px 12px' }}>
        <Container style={{ maxWidth: 560, margin: '0 auto' }}>
          <Section style={{ padding: '0 4px 20px' }}>
            <table role="presentation" cellPadding={0} cellSpacing={0}>
              <tbody>
                <tr>
                  <td style={{ verticalAlign: 'middle' }}>
                    {b.hasLogo ? (
                      <Img src="cid:logo" alt={b.name} height={40} style={{ height: 40, width: 'auto', borderRadius: 8 }} />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: b.accent, color: '#fff', fontWeight: 700, fontSize: 15, lineHeight: '40px', textAlign: 'center' }}>{initials}</div>
                    )}
                  </td>
                  <td style={{ verticalAlign: 'middle', paddingLeft: 12, fontSize: 16, fontWeight: 600, color: colors.text }}>{b.name}</td>
                </tr>
              </tbody>
            </table>
          </Section>
          <Section style={{ backgroundColor: '#ffffff', borderRadius: 12, border: `1px solid ${colors.border}`, borderTop: `4px solid ${b.accent}`, padding: '28px 32px' }}>{children}</Section>
          <Section style={{ padding: '20px 8px 0', textAlign: 'center' }}>
            {b.footer && <Text style={{ color: colors.muted, fontSize: 12, lineHeight: '18px', margin: '0 0 6px', whiteSpace: 'pre-line' }}>{b.footer}</Text>}
            {b.supportEmail && (
              <Text style={{ color: colors.muted, fontSize: 12, margin: '0 0 6px' }}>
                Questions? <Link href={`mailto:${b.supportEmail}`} style={{ color: colors.muted, textDecoration: 'underline' }}>{b.supportEmail}</Link>
              </Text>
            )}
            {!b.hidePoweredBy && (
              <Text style={{ color: '#94a3b8', fontSize: 11, margin: 0 }}>
                Sent by <Link href="https://github.com/flyingwebie/convex-backup-console" style={{ color: '#94a3b8' }}>Convex Backup Console</Link>
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const cell = { padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontSize: 13, color: colors.text }
const pill = (ok: boolean) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, backgroundColor: ok ? '#dcfce7' : '#fee2e2', color: ok ? '#166534' : '#991b1b' })

/** Built-in details block per email type (toggle "showDetails"). */
function Details({ type, ctx, tz }: { type: AnyType; ctx: Record<string, any>; tz: string }) {
  const fmtDate = (v: unknown) => (v ? new Date(String(v)).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never')
  if (type.startsWith('backup_') && ctx.run) {
    const rows: [string, ReactNode][] = [
      ['Instance', `${ctx.instance?.name ?? ''}${ctx.instance?.kind === 'cloud' ? ' (Convex Cloud)' : ''}`],
      ['Job', ctx.job?.name],
      ['Started', fmtDate(ctx.run.started_at)],
      ...(ctx.run.duration ? [['Duration', ctx.run.duration] as [string, ReactNode]] : []),
      ...(ctx.run.bytes ? [['Size', fmtBytes(ctx.run.bytes)] as [string, ReactNode]] : []),
    ]
    return (
      <Section style={{ marginTop: 20 }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><td style={{ ...cell, color: colors.muted, width: 110 }}>{k}</td><td style={cell}>{v}</td></tr>
            ))}
            {(ctx.run.copies ?? []).map((c: { destination: string; status: string; error: string | null }) => (
              <tr key={c.destination}>
                <td style={{ ...cell, color: colors.muted }}>Copy</td>
                <td style={cell}>
                  {c.destination} <span style={pill(c.status === 'ok')}>{c.status === 'ok' ? 'stored' : 'failed'}</span>
                  {c.error && <div style={{ color: '#991b1b', fontSize: 12, marginTop: 2 }}>{c.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    )
  }
  if (type === 'digest' && Array.isArray(ctx.instances)) {
    return (
      <Section style={{ marginTop: 20 }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
          <tbody>
            <tr><td style={{ ...cell, color: colors.muted, fontSize: 12 }}>Instance</td><td style={{ ...cell, color: colors.muted, fontSize: 12 }}>Last good backup</td><td style={{ ...cell, color: colors.muted, fontSize: 12, textAlign: 'right' }}>Status</td></tr>
            {ctx.instances.map((i: { name: string; healthy: boolean; last_good_backup: string | null; protected: boolean }) => (
              <tr key={i.name}>
                <td style={{ ...cell, fontWeight: 600 }}>{i.name}</td>
                <td style={cell}>{fmtDate(i.last_good_backup)}{!i.protected && <span style={{ color: colors.muted }}> · no active job</span>}</td>
                <td style={{ ...cell, textAlign: 'right' }}><span style={pill(i.healthy)}>{i.healthy ? 'healthy' : 'attention'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {Array.isArray(ctx.failures) && ctx.failures.length > 0 && (
          <>
            <Text style={{ fontSize: 13, fontWeight: 600, color: colors.text, margin: '20px 0 6px' }}>Recent failures</Text>
            {ctx.failures.map((f: { instance: string; error: string }, i: number) => (
              <Text key={i} style={{ fontSize: 13, color: '#991b1b', margin: '0 0 4px' }}>• {f.instance}: {f.error}</Text>
            ))}
          </>
        )}
      </Section>
    )
  }
  return null
}

function StructuredEmail({ b, type, s, ctx }: { b: Branding; type: AnyType; s: Record<keyof Structured, any>; ctx: Record<string, unknown> }) {
  return (
    <Layout b={b} preheader={s.preheader}>
      <Heading as="h1" style={{ fontSize: 22, lineHeight: '30px', fontWeight: 700, color: colors.text, margin: '0 0 16px' }}>{s.heading}</Heading>
      <div style={{ fontSize: 15, lineHeight: '24px', color: '#334155' }} dangerouslySetInnerHTML={{ __html: s.body }} />
      {s.buttonLabel && s.buttonUrl && (
        <Section style={{ marginTop: 24 }}>
          <Button href={s.buttonUrl} style={{ backgroundColor: b.accent, color: '#ffffff', borderRadius: 8, padding: '12px 20px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            {s.buttonLabel}
          </Button>
        </Section>
      )}
      {s.showDetails && <Details type={type} ctx={ctx as Record<string, any>} tz={b.timezone} />}
    </Layout>
  )
}

/** Renders one email. `ctx` already contains workspace/recipient + the type's variables. */
export async function renderEmail(type: AnyType, template: StoredTemplate, b: Branding, ctx: Record<string, unknown>): Promise<Rendered> {
  const text = engine(b.timezone, false)
  const html = engine(b.timezone, true)
  if (template.mode === 'html') {
    const subject = (await text.parseAndRender(template.subject, ctx)).trim()
    const body = sanitizeEmailHtml(await html.parseAndRender(template.html, ctx))
    return { subject, html: body, text: toPlainText(body) }
  }
  const c = template.content
  const s = {
    subject: (await text.parseAndRender(c.subject, ctx)).trim(),
    preheader: (await text.parseAndRender(c.preheader, ctx)).trim(),
    heading: (await text.parseAndRender(c.heading, ctx)).trim(),
    body: sanitizeHtml(await marked.parse(await html.parseAndRender(c.body, ctx), { async: true, breaks: true }), MD_ALLOW),
    buttonLabel: (await text.parseAndRender(c.buttonLabel, ctx)).trim(),
    buttonUrl: (await text.parseAndRender(c.buttonUrl, ctx)).trim(),
    showDetails: c.showDetails,
  }
  const out = await render(<StructuredEmail b={b} type={type} s={s} ctx={ctx} />)
  return { subject: s.subject, html: out, text: toPlainText(out) }
}

/** The structured default rendered to HTML — the starting point for owners switching to full HTML. */
export async function exportDesignAsHtml(type: EmailType, content: Structured, b: Branding) {
  // Render the layout with Liquid placeholders left in, so the exported HTML stays a template.
  const s = {
    subject: content.subject,
    preheader: content.preheader,
    heading: content.heading,
    body: sanitizeHtml(await marked.parse(content.body, { async: true, breaks: true }), { ...MD_ALLOW, allowedTags: [...(MD_ALLOW.allowedTags as string[])] }),
    buttonLabel: content.buttonLabel,
    buttonUrl: content.buttonUrl,
    showDetails: false,
  }
  return render(<StructuredEmail b={b} type={type} s={s} ctx={{}} />, { pretty: true })
}

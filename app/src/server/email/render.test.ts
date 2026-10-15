import { describe, expect, it } from 'vitest'
import { COMMON_SAMPLE, EMAIL_TYPES, EMAIL_TYPE_KEYS } from '~/lib/email-types'
import { renderEmail, sanitizeEmailHtml, unknownVariables, validateTemplate, type Branding } from './render.server'

const b: Branding = { name: 'Acme', hasLogo: false, accent: '#4f46e5', footer: 'Acme Ltd · Dublin', supportEmail: 'help@acme.dev', hidePoweredBy: false, consoleUrl: 'https://x', timezone: 'Europe/Dublin' }

describe('email renderer', () => {
  it('renders every default template with its sample data', async () => {
    for (const type of EMAIL_TYPE_KEYS) {
      const def = EMAIL_TYPES[type]
      const out = await renderEmail(type, { mode: 'structured', content: def.defaults }, b, { ...COMMON_SAMPLE, ...def.sample })
      expect(out.subject).not.toContain('{{')
      expect(out.html).toContain('Acme')
      expect(out.text.length).toBeGreaterThan(20)
      expect(unknownVariables(type, Object.values(def.defaults).filter((v): v is string => typeof v === 'string'))).toEqual([])
    }
  })

  it('escapes variable values in the body', async () => {
    const out = await renderEmail('backup_failed', { mode: 'structured', content: EMAIL_TYPES.backup_failed.defaults }, b, {
      ...COMMON_SAMPLE,
      ...EMAIL_TYPES.backup_failed.sample,
      run: { error: '<img src=x onerror=alert(1)>', copies: [] },
    })
    expect(out.html).not.toMatch(/<img[^>]*onerror/)
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('formats dates in the workspace timezone and bytes', async () => {
    const out = await renderEmail(
      'backup_succeeded',
      { mode: 'structured', content: { ...EMAIL_TYPES.backup_succeeded.defaults, body: '{{ run.started_at | date: "%H:%M" }} {{ run.bytes | bytes }}' } },
      b,
      { ...COMMON_SAMPLE, run: { started_at: '2026-10-14T03:00:00Z', bytes: 2_500_000_000 } },
    )
    expect(out.html).toContain('04:00 2.3 GB')
  })

  it('strips scripts, forms and handlers from owner HTML', () => {
    const clean = sanitizeEmailHtml('<!DOCTYPE html><html><body><script>x()</script><p onclick="x()">Hi</p><form><input></form><iframe src="x"></iframe><a href="javascript:x()">l</a></body></html>')
    expect(clean).not.toMatch(/script|onclick|<form|<iframe|javascript:/)
    expect(clean).toContain('<p>Hi</p>')
  })

  it('rejects unknown variables and syntax errors', () => {
    expect(() => validateTemplate('digest', { mode: 'html', subject: '{{ workspace.nam }}', html: '' })).toThrow(/workspace.nam/)
    expect(() => validateTemplate('digest', { mode: 'html', subject: '{% if %}', html: '' })).toThrow(/subject/)
    expect(() => validateTemplate('digest', { mode: 'html', subject: '{% for i in instances %}{{ i.name }}{% endfor %}', html: '' })).not.toThrow()
  })
})

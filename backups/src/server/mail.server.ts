import nodemailer from 'nodemailer'
import { decrypt, encrypt } from './crypto.server'
import { getSetting, setSetting } from './db.server'
import { env } from './env.server'

// Platform-wide SMTP (used for invitations). Workspace alert emails use their own channel config.
export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }

export function getSmtp(): SmtpConfig | null {
  const enc = getSetting('smtp')
  return enc ? (JSON.parse(decrypt(enc)) as SmtpConfig) : null
}

export function saveSmtp(cfg: SmtpConfig | null) {
  setSetting('smtp', cfg ? encrypt(JSON.stringify(cfg)) : '')
}

export async function sendMail(to: string, subject: string, text: string, cfg = getSmtp()) {
  if (!cfg) throw new Error('SMTP is not configured')
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  })
  await transport.sendMail({ from: cfg.from, to, subject, text })
}

export function invitationUrl(id: string) {
  return `${env.publicUrl}/invite/${id}`
}

/** Better Auth hook: emails the invitation link when SMTP is configured; otherwise the link is copied manually. */
export async function sendInvitationEmail(data: {
  id: string
  role: string
  email: string
  organization: { name: string }
  inviter: { user: { name: string; email: string } }
}) {
  if (!getSmtp()) return
  await sendMail(
    data.email,
    `You're invited to ${data.organization.name} on Convex Backup Console`,
    [
      `${data.inviter.user.name} (${data.inviter.user.email}) invited you to the "${data.organization.name}" workspace as ${data.role}.`,
      '',
      `Accept the invitation: ${invitationUrl(data.id)}`,
      '',
      'The link expires in 7 days. You will be asked to set up two-factor authentication.',
    ].join('\n'),
  ).catch((err: unknown) => console.error('[mail] invitation email failed:', err))
}

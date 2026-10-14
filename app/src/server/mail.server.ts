import nodemailer from 'nodemailer'
import { decrypt, encrypt } from './crypto.server'
import { getSetting, setSetting } from './db.server'
import { roleLabel, sendWorkspaceEmail } from './email/service.server'
import { env } from './env.server'

// Platform-wide SMTP. Workspaces send through it unless an owner sets the workspace's own SMTP (Emails page).
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
  organization: { id: string; name: string }
  invitation: { expiresAt: Date }
  inviter: { user: { name: string; email: string } }
}) {
  await sendWorkspaceEmail(
    data.organization.id,
    'invitation',
    {
      inviter: { name: data.inviter.user.name, email: data.inviter.user.email },
      invitation: { role: roleLabel(data.role), accept_url: invitationUrl(data.id), expires_at: new Date(data.invitation.expiresAt).toISOString() },
    },
    { to: { email: data.email } },
  )
}

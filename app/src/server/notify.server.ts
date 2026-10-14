import { decrypt } from './crypto.server'
import { audit, db } from './db.server'
import { env } from './env.server'

// Chat/webhook alerts. Emails have their own templates and recipients (see ./email).
export type ChannelKind = 'webhook' | 'discord' | 'slack' | 'telegram'

export type ChannelConfig =
  | { kind: 'webhook'; url: string }
  | { kind: 'discord'; url: string }
  | { kind: 'slack'; url: string }
  | { kind: 'telegram'; botToken: string; chatId: string }

export type NotifyEvent = {
  type: 'backup' | 'restore' | 'test'
  status: 'ok' | 'partial' | 'failed'
  title: string
  details: string[]
}

type ChannelRow = { id: string; name: string; kind: ChannelKind; config_enc: string; on_failure: number; on_success: number }

/** Fans an event out to every channel of the workspace subscribed to it. Never throws. */
export async function notify(workspaceId: string, event: NotifyEvent) {
  const failure = event.status !== 'ok'
  const channels = db()
    .prepare(`SELECT * FROM channels WHERE workspace_id = ? AND kind != 'email' AND ${failure ? 'on_failure' : 'on_success'} = 1`)
    .all(workspaceId) as ChannelRow[]
  const ws = db().prepare('SELECT name FROM organization WHERE id = ?').get(workspaceId) as { name: string } | undefined
  const scoped = ws ? { ...event, title: `[${ws.name}] ${event.title}` } : event
  await Promise.all(
    channels.map((c) =>
      send(JSON.parse(decrypt(c.config_enc)) as ChannelConfig, scoped).catch((err: unknown) =>
        audit(workspaceId, 'system', 'notify.failed', { channel: c.name, error: err instanceof Error ? err.message : String(err) }),
      ),
    ),
  )
}

const icon = { ok: '✅', partial: '⚠️', failed: '❌' } as const

export async function send(cfg: ChannelConfig, event: NotifyEvent) {
  const text = `${icon[event.status]} ${event.title}\n${event.details.join('\n')}\n${env.publicUrl}`
  switch (cfg.kind) {
    case 'webhook':
      return post(cfg.url, { ...event, console: env.publicUrl, at: new Date().toISOString() })
    case 'discord':
      return post(cfg.url, {
        embeds: [
          {
            title: `${icon[event.status]} ${event.title}`,
            description: event.details.join('\n'),
            url: env.publicUrl,
            color: event.status === 'ok' ? 0x16a34a : event.status === 'partial' ? 0xd97706 : 0xdc2626,
          },
        ],
      })
    case 'slack':
      return post(cfg.url, { text })
    case 'telegram':
      return post(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, { chat_id: cfg.chatId, text })
  }
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
}

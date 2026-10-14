import { createFileRoute } from '@tanstack/react-router'
import { audit, db } from '~/server/db.server'
import { requireWorkspace } from '~/server/workspace.server'

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  // Quote, and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replaceAll('"', '""')}"`
}

// GET /api/audit.csv — the active workspace's full audit log.
export const Route = createFileRoute('/api/audit.csv')({
  server: {
    handlers: {
      GET: async () => {
        const ctx = await requireWorkspace('view').catch(() => null)
        if (!ctx) return new Response('Unauthorized', { status: 401 })
        const rows = db().prepare('SELECT at, actor, action, detail FROM audit WHERE workspace_id = ? ORDER BY id').all(ctx.ws.id) as {
          at: number
          actor: string
          action: string
          detail: string | null
        }[]
        const lines = ['time_utc,actor,action,detail', ...rows.map((r) => [new Date(r.at).toISOString(), r.actor, r.action, r.detail].map(cell).join(','))]
        audit(ctx.ws.id, ctx.user.email, 'audit.exported', { rows: rows.length })
        return new Response(lines.join('\r\n') + '\r\n', {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="audit-${ctx.ws.slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})

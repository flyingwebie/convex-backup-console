import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'
import { ensureBooted } from '~/server/boot.server'
import { db } from '~/server/db.server'
import { workspaceHealth } from '~/server/health.server'

// GET /api/status/<token> — for uptime monitors. 200 when every instance had a good backup recently, else 503.
export const Route = createFileRoute('/api/status/$token')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        await ensureBooted()
        const rows = db().prepare('SELECT workspace_id, status_token FROM workspace_settings WHERE status_token IS NOT NULL AND deleted_at IS NULL').all() as {
          workspace_id: string
          status_token: string
        }[]
        const given = Buffer.from(params.token)
        const match = rows.find((r) => r.status_token.length === params.token.length && timingSafeEqual(Buffer.from(r.status_token), given))
        if (!match) return Response.json({ error: 'Unknown status token' }, { status: 404 })
        const health = workspaceHealth(match.workspace_id)
        return Response.json(health, { status: health.healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
      },
    },
  },
})

import { createFileRoute } from '@tanstack/react-router'
import { apiAuth, json } from '~/server/api.server'
import { workspaceHealth } from '~/server/health.server'

// GET /api/v1/status — backup health of the token's workspace (200 healthy / 503 not).
export const Route = createFileRoute('/api/v1/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await apiAuth(request, 'read')
        if (ctx instanceof Response) return ctx
        const health = workspaceHealth(ctx.workspaceId)
        return json(health, health.healthy ? 200 : 503)
      },
    },
  },
})

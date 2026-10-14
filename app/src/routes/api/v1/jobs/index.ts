import { createFileRoute } from '@tanstack/react-router'
import { apiAuth, json } from '~/server/api.server'
import { db } from '~/server/db.server'

// GET /api/v1/jobs — jobs in the token's workspace.
export const Route = createFileRoute('/api/v1/jobs/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await apiAuth(request, 'read')
        if (ctx instanceof Response) return ctx
        const jobs = db()
          .prepare(
            `SELECT j.id, j.name, j.cron, j.enabled, i.name AS instance FROM jobs j JOIN instances i ON i.id = j.instance_id
             WHERE j.workspace_id = ? AND j.deleted_at IS NULL ORDER BY j.name`,
          )
          .all(ctx.workspaceId) as { id: string; name: string; cron: string | null; enabled: number; instance: string }[]
        return json({ jobs: jobs.map((j) => ({ ...j, enabled: Boolean(j.enabled) })) })
      },
    },
  },
})

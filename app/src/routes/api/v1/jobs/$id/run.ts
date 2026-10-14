import { createFileRoute } from '@tanstack/react-router'
import { apiAuth, apiError, json } from '~/server/api.server'
import { startJob } from '~/server/backup.server'
import { audit, db } from '~/server/db.server'

// POST /api/v1/jobs/:id/run — start a backup now. Returns 202 { runId }. Requires a "run" token.
export const Route = createFileRoute('/api/v1/jobs/$id/run')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const ctx = await apiAuth(request, 'run')
        if (ctx instanceof Response) return ctx
        if (!db().prepare('SELECT 1 FROM jobs WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(params.id, ctx.workspaceId)) {
          return apiError(404, 'Job not found')
        }
        try {
          const runId = startJob(params.id, `api:${ctx.tokenName}`)
          audit(ctx.workspaceId, `api:${ctx.tokenName}`, 'backup.started', { jobId: params.id, runId })
          return json({ runId, status: 'running' }, 202)
        } catch (err) {
          return apiError(409, err instanceof Error ? err.message : String(err))
        }
      },
    },
  },
})

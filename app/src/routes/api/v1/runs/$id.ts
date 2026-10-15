import { createFileRoute } from '@tanstack/react-router'
import { apiAuth, apiError, json } from '~/server/api.server'
import { db } from '~/server/db.server'

// GET /api/v1/runs/:id — status of a backup run: running | ok | partial | failed.
export const Route = createFileRoute('/api/v1/runs/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await apiAuth(request, 'read')
        if (ctx instanceof Response) return ctx
        const run = db()
          .prepare('SELECT id, job_id, status, started_at, finished_at, bytes, error, sha256 FROM runs WHERE id = ? AND workspace_id = ?')
          .get(params.id, ctx.workspaceId) as Record<string, unknown> | undefined
        if (!run) return apiError(404, 'Run not found')
        const copies = db().prepare('SELECT d.name AS destination, c.status, c.error FROM run_copies c JOIN destinations d ON d.id = c.destination_id WHERE c.run_id = ?').all(params.id)
        return json({
          ...run,
          started_at: new Date(run.started_at as number).toISOString(),
          finished_at: run.finished_at ? new Date(run.finished_at as number).toISOString() : null,
          copies,
        })
      },
    },
  },
})

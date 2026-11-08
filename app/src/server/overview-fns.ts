import { createServerFn } from '@tanstack/react-start'
import { db } from './db.server'
import { requireWorkspace } from './workspace.server'

/**
 * Overview-page-only server functions (DESIGN.md §5.2/§5.6 topology map). Kept out of fns.ts so the
 * big shared file doesn't grow — this derives data the schema doesn't store directly (per-edge
 * last-run health for the Instances → Jobs → Destinations graph) from `runs` / `run_copies`, which
 * already exist.
 */

export type TopologyEdgeHealth = 'success' | 'danger' | 'running' | 'inactive'

export type TopologyEdgeData = {
  from: string
  to: string
  health: TopologyEdgeHealth
  label?: string
}

function shortTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = diff / 60_000
  if (m < 1) return 'just now'
  if (m < 60) return `${Math.round(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.round(h)}h ago`
  const d = h / 24
  if (d < 30) return `${Math.round(d)}d ago`
  return `${Math.round(d / 30)}mo ago`
}

/**
 * Edge health for the topology map: Instance → Job (the job's most recent run against that
 * instance) and Job → Destination (the most recent copy attempt to that destination from that
 * job's runs). A job/destination pair with no run yet is "inactive" (dashed, gray).
 */
export const getOverviewTopology = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')

  const jobs = db()
    .prepare(
      `SELECT j.id, j.instance_id, GROUP_CONCAT(jd.destination_id) AS destination_ids FROM jobs j
       LEFT JOIN job_destinations jd ON jd.job_id = j.id
       WHERE j.workspace_id = ? AND j.deleted_at IS NULL GROUP BY j.id`,
    )
    .all(ws.id) as { id: string; instance_id: string; destination_ids: string | null }[]

  const edges: TopologyEdgeData[] = []

  for (const job of jobs) {
    const lastRun = db()
      .prepare('SELECT status, started_at FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(job.id) as { status: string; started_at: number } | undefined

    edges.push({
      from: job.instance_id,
      to: job.id,
      health: !lastRun ? 'inactive' : lastRun.status === 'running' ? 'running' : lastRun.status === 'failed' ? 'danger' : 'success',
      label: !lastRun ? undefined : lastRun.status === 'running' ? 'live' : shortTimeAgo(lastRun.started_at),
    })

    const destinationIds = job.destination_ids ? job.destination_ids.split(',') : []
    for (const destinationId of destinationIds) {
      const lastCopy = db()
        .prepare(
          `SELECT rc.status AS copy_status, r.status AS run_status, r.started_at FROM run_copies rc
           JOIN runs r ON r.id = rc.run_id
           WHERE r.job_id = ? AND rc.destination_id = ? ORDER BY r.started_at DESC LIMIT 1`,
        )
        .get(job.id, destinationId) as { copy_status: string; run_status: string; started_at: number } | undefined

      edges.push({
        from: job.id,
        to: destinationId,
        health: !lastCopy ? 'inactive' : lastCopy.run_status === 'running' ? 'running' : lastCopy.copy_status === 'ok' ? 'success' : 'danger',
        label: !lastCopy ? undefined : lastCopy.run_status === 'running' ? 'live' : shortTimeAgo(lastCopy.started_at),
      })
    }
  }

  return { edges }
})

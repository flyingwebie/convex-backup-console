import { createServerFn } from '@tanstack/react-start'
import { db } from './db.server'
import { requireWorkspace } from './workspace.server'

/**
 * "Jump to" results for the ⌘K command palette — the small set of fields each entity-kind row
 * needs (name + one mono meta fragment), nothing else. Cheap: three indexed, limited lookups
 * against the active workspace, no joins beyond what's already indexed for the list pages.
 */
export const getCommandPaletteEntities = createServerFn({ method: 'GET' }).handler(async () => {
  const { ws } = await requireWorkspace('view')
  const instances = db()
    .prepare('SELECT id, name, url FROM instances WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name LIMIT 25')
    .all(ws.id) as { id: string; name: string; url: string }[]
  const jobs = db()
    .prepare('SELECT id, name, cron FROM jobs WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name LIMIT 25')
    .all(ws.id) as { id: string; name: string; cron: string | null }[]
  const destinations = db()
    .prepare('SELECT id, name, kind FROM destinations WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name LIMIT 25')
    .all(ws.id) as { id: string; name: string; kind: string }[]
  return {
    instances: instances.map((i) => ({ id: i.id, name: i.name, meta: i.url.replace(/^https?:\/\//, '') })),
    jobs: jobs.map((j) => ({ id: j.id, name: j.name, meta: j.cron ?? 'manual' })),
    destinations: destinations.map((d) => ({ id: d.id, name: d.name, meta: d.kind === 'local' ? 'local' : d.kind })),
  }
})

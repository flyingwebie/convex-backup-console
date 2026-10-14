import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ConvexAdmin, type ImportMode } from './convex.server'
import { decrypt } from './crypto.server'
import { audit, db } from './db.server'
import { env } from './env.server'
import { pipeline } from 'node:stream/promises'
import { decryptStream } from './encryption.server'
import { notify } from './notify.server'
import { openDestination, type DestinationRow } from './storage.server'

const restoring = new Set<string>()

export function isRestoring(instanceId: string) {
  return restoring.has(instanceId)
}

export type RestoreRequest = {
  runId: string
  destinationId: string
  targetInstanceId: string
  mode: ImportMode
  confirm: string
  actor: string
}

/** Validates the request, then restores in the background. Returns the restore id. */
export function startRestore(req: RestoreRequest): string {
  const copy = db()
    .prepare("SELECT object_key FROM run_copies WHERE run_id = ? AND destination_id = ? AND status = 'ok' AND deleted_at IS NULL")
    .get(req.runId, req.destinationId) as { object_key: string } | undefined
  if (!copy) throw new Error('Backup copy not found (it may have been pruned)')
  const target = db().prepare('SELECT * FROM instances WHERE id = ?').get(req.targetInstanceId) as
    | { id: string; name: string; url: string; admin_key_enc: string }
    | undefined
  if (!target) throw new Error('Target instance not found')
  // Typed confirmation: the operator must type the exact target name.
  if (req.confirm !== target.name) throw new Error(`Type the target instance name "${target.name}" to confirm`)
  if (restoring.has(target.id)) throw new Error('A restore into this instance is already running')

  const id = randomUUID()
  db()
    .prepare(
      `INSERT INTO restores (id, run_id, destination_id, object_key, target_instance_id, target_name, mode, actor, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    )
    .run(id, req.runId, req.destinationId, copy.object_key, target.id, target.name, req.mode, req.actor, Date.now())
  audit(req.actor, 'restore.started', { id, ...req, confirm: undefined, key: copy.object_key, target: target.name })
  restoring.add(target.id)

  void (async () => {
    const tmpDir = path.join(env.dataDir, 'tmp')
    await fs.promises.mkdir(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, `restore-${id}.zip`)
    try {
      const destRow = db().prepare('SELECT * FROM destinations WHERE id = ?').get(req.destinationId) as DestinationRow
      const source = await openDestination(destRow).get(copy.object_key)
      await pipeline(copy.object_key.endsWith('.age') ? await decryptStream(source) : source, fs.createWriteStream(tmpFile))
      const convex = new ConvexAdmin(target.url, decrypt(target.admin_key_enc))
      const rows = await convex.importZip(tmpFile, req.mode, (message) => {
        db().prepare('UPDATE restores SET confirm_message = ? WHERE id = ?').run(message, id)
      })
      db().prepare("UPDATE restores SET status = 'ok', rows_written = ?, finished_at = ? WHERE id = ?").run(rows, Date.now(), id)
      audit('system', 'restore.completed', { id, rows })
      await notify({ type: 'restore', status: 'ok', title: `Restore completed into ${target.name}`, details: [`Backup: ${copy.object_key}`, `Mode: ${req.mode}`, `Documents: ${rows}`, `By: ${req.actor}`] })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      db().prepare("UPDATE restores SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(message, Date.now(), id)
      audit('system', 'restore.failed', { id, error: message })
      await notify({ type: 'restore', status: 'failed', title: `Restore into ${target.name} failed`, details: [`Backup: ${copy.object_key}`, message] })
    } finally {
      restoring.delete(target.id)
      await fs.promises.rm(tmpFile, { force: true })
    }
  })()
  return id
}

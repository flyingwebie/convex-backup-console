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
import { workspaceSettings } from './workspace.server'
import { makeScrubber, rewriteZip, type ScrubRule } from './zip.server'

const restoring = new Set<string>()

export function isRestoring(instanceId: string) {
  return restoring.has(instanceId)
}

export type RestoreRequest = {
  workspaceId: string
  runId: string
  destinationId: string
  targetInstanceId: string
  mode: ImportMode
  confirm: string
  actor: string
  /** Restore only these tables (others in the target are untouched). */
  tables?: string[]
  includeFiles?: boolean
  /** Apply the workspace's scrubbing rules (fake emails, names…) before importing. */
  scrub?: boolean
}

/** Validates the request, then restores in the background. Returns the restore id. */
export function startRestore(req: RestoreRequest): string {
  const copy = db()
    .prepare(
      `SELECT c.object_key FROM run_copies c JOIN runs r ON r.id = c.run_id
       WHERE c.run_id = ? AND c.destination_id = ? AND c.status = 'ok' AND c.deleted_at IS NULL AND r.workspace_id = ?`,
    )
    .get(req.runId, req.destinationId, req.workspaceId) as { object_key: string } | undefined
  if (!copy) throw new Error('Backup copy not found (it may have been pruned)')
  const target = db()
    .prepare('SELECT * FROM instances WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL')
    .get(req.targetInstanceId, req.workspaceId) as
    | { id: string; name: string; url: string; admin_key_enc: string }
    | undefined
  if (!target) throw new Error('Target instance not found')
  // Typed confirmation: the operator must type the exact target name.
  if (req.confirm !== target.name) throw new Error(`Type the target instance name "${target.name}" to confirm`)
  if (restoring.has(target.id)) throw new Error('A restore into this instance is already running')
  const rules = JSON.parse(workspaceSettings(req.workspaceId).scrub_rules ?? '[]') as ScrubRule[]
  if (req.scrub && rules.length === 0) throw new Error('This workspace has no scrubbing rules yet (Workspace settings → Data scrubbing)')
  const partial = Boolean(req.tables?.length)
  // A partial restore replaces only the selected tables, so "replace all" becomes "replace".
  const mode: ImportMode = partial && req.mode === 'replaceAll' ? 'replace' : req.mode

  const id = randomUUID()
  db()
    .prepare(
      `INSERT INTO restores (id, workspace_id, run_id, destination_id, object_key, target_instance_id, target_name, mode, actor, status, started_at, tables, scrubbed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    )
    .run(id, req.workspaceId, req.runId, req.destinationId, copy.object_key, target.id, target.name, mode, req.actor, Date.now(), partial ? JSON.stringify(req.tables) : null, req.scrub ? 1 : 0)
  audit(req.workspaceId, req.actor, 'restore.started', { id, ...req, confirm: undefined, key: copy.object_key, target: target.name })
  restoring.add(target.id)

  void (async () => {
    const tmpDir = path.join(env.dataDir, 'tmp')
    await fs.promises.mkdir(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, `restore-${id}.zip`)
    try {
      const destRow = db().prepare('SELECT * FROM destinations WHERE id = ?').get(req.destinationId) as DestinationRow
      const source = await openDestination(destRow).get(copy.object_key)
      await pipeline(copy.object_key.endsWith('.age') ? await decryptStream(req.workspaceId, source) : source, fs.createWriteStream(tmpFile))
      let importFile = tmpFile
      if (partial || req.scrub || req.includeFiles === false) {
        importFile = `${tmpFile}.prepared.zip`
        const { scrubbed } = await rewriteZip(tmpFile, importFile, {
          tables: partial ? req.tables : undefined,
          includeFiles: partial ? Boolean(req.includeFiles) : req.includeFiles !== false,
          scrub: req.scrub ? makeScrubber(rules) : undefined,
        })
        if (req.scrub) audit(req.workspaceId, 'system', 'restore.scrubbed', { id, fieldsReplaced: scrubbed })
      }
      const convex = new ConvexAdmin(target.url, decrypt(target.admin_key_enc))
      const rows = await convex.importZip(importFile, mode, (message) => {
        db().prepare('UPDATE restores SET confirm_message = ? WHERE id = ?').run(message, id)
      })
      db().prepare("UPDATE restores SET status = 'ok', rows_written = ?, finished_at = ? WHERE id = ?").run(rows, Date.now(), id)
      audit(req.workspaceId, 'system', 'restore.completed', { id, rows })
      await notify(req.workspaceId, { type: 'restore', status: 'ok', title: `Restore completed into ${target.name}`, details: [`Backup: ${copy.object_key}`, `Mode: ${req.mode}`, `Documents: ${rows}`, `By: ${req.actor}`] })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      db().prepare("UPDATE restores SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(message, Date.now(), id)
      audit(req.workspaceId, 'system', 'restore.failed', { id, error: message })
      await notify(req.workspaceId, { type: 'restore', status: 'failed', title: `Restore into ${target.name} failed`, details: [`Backup: ${copy.object_key}`, message] })
    } finally {
      restoring.delete(target.id)
      await fs.promises.rm(tmpFile, { force: true })
      await fs.promises.rm(`${tmpFile}.prepared.zip`, { force: true })
    }
  })()
  return id
}

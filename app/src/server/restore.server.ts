import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ConvexAdmin, type ImportMode, type LogLevel } from './convex.server'
import { decrypt } from './crypto.server'
import { audit, db } from './db.server'
import { env } from './env.server'
import { formatBytes } from '~/lib/format'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { decryptStream } from './encryption.server'
import { emailForRestore } from './email/events.server'
import { notify } from './notify.server'
import { openDestination, type DestinationRow } from './storage.server'
import { workspaceSettings } from './workspace.server'
import { makeScrubber, rewriteZip, type ScrubRule } from './zip.server'

const restoring = new Set<string>()

/** Appends a line to a restore's live log (multi-line text becomes one row per line). */
function restoreLogger(restoreId: string) {
  const insert = db().prepare('INSERT INTO restore_logs (restore_id, at, level, text) VALUES (?, ?, ?, ?)')
  return (text: string, level: LogLevel = 'info') => {
    const at = Date.now()
    for (const line of text.replace(/\r/g, '').replace(/\n+$/, '').split('\n')) insert.run(restoreId, at, level, line)
  }
}

const size = formatBytes

const seconds = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)}s`

/** Counts bytes flowing through and reports progress at most every 2 seconds. */
function progressMeter(report: (done: number) => void) {
  let done = 0
  let last = Date.now()
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      done += chunk.length
      if (Date.now() - last >= 2000) {
        last = Date.now()
        report(done)
      }
      cb(null, chunk)
    },
  })
}

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
      `SELECT c.object_key, r.bytes, r.started_at AS backup_at, i.name AS source_name, d.name AS destination_name, d.kind AS destination_kind
       FROM run_copies c JOIN runs r ON r.id = c.run_id
       LEFT JOIN instances i ON i.id = r.instance_id
       LEFT JOIN destinations d ON d.id = c.destination_id
       WHERE c.run_id = ? AND c.destination_id = ? AND c.status = 'ok' AND c.deleted_at IS NULL AND r.workspace_id = ?`,
    )
    .get(req.runId, req.destinationId, req.workspaceId) as
    | { object_key: string; bytes: number | null; backup_at: number; source_name: string | null; destination_name: string | null; destination_kind: string | null }
    | undefined
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
  const log = restoreLogger(id)
  const t0 = Date.now()
  log(`Restore ${id}`, 'dim')
  log(`Source:  ${copy.source_name ?? 'deleted instance'} — backup from ${new Date(copy.backup_at).toISOString()}`)
  log(`Storage: ${copy.destination_name ?? 'deleted destination'}${copy.destination_kind ? ` (${copy.destination_kind})` : ''} → ${copy.object_key}`)
  log(`Target:  ${target.name} (${target.url})`)
  log(`Mode:    ${mode}${partial ? ` — tables: ${req.tables!.join(', ')}${req.includeFiles ? ' + files' : ''}` : req.includeFiles === false ? ' — without files' : ''}${req.scrub ? ' — scrubbed' : ''}`)
  log(`By:      ${req.actor}`, 'dim')

  void (async () => {
    const tmpDir = path.join(env.dataDir, 'tmp')
    await fs.promises.mkdir(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, `restore-${id}.zip`)
    try {
      const destRow = db().prepare('SELECT * FROM destinations WHERE id = ?').get(req.destinationId) as DestinationRow
      const encrypted = copy.object_key.endsWith('.age')
      log(`Downloading backup${copy.bytes ? ` (${size(copy.bytes)})` : ''}…`)
      let step = Date.now()
      const source = await openDestination(destRow).get(copy.object_key)
      const meter = progressMeter((done) =>
        log(`  ${size(done)}${copy.bytes ? ` of ${size(copy.bytes)} (${Math.min(100, Math.round((done / copy.bytes) * 100))}%)` : ''} downloaded`, 'dim'),
      )
      const counted = source.pipe(meter)
      source.on('error', (e) => counted.destroy(e))
      if (encrypted) log('Decrypting with the workspace age key (streaming)', 'dim')
      await pipeline(encrypted ? await decryptStream(req.workspaceId, counted) : counted, fs.createWriteStream(tmpFile))
      const zipSize = (await fs.promises.stat(tmpFile)).size
      log(`Downloaded${encrypted ? ' and decrypted' : ''} — ${size(zipSize)} snapshot in ${seconds(step)}`, 'success')
      let importFile = tmpFile
      if (partial || req.scrub || req.includeFiles === false) {
        step = Date.now()
        log(`Preparing snapshot${partial ? ` (keeping ${req.tables!.length} table${req.tables!.length === 1 ? '' : 's'})` : ''}${req.scrub ? ' and scrubbing personal data' : ''}…`)
        importFile = `${tmpFile}.prepared.zip`
        const { scrubbed } = await rewriteZip(tmpFile, importFile, {
          tables: partial ? req.tables : undefined,
          includeFiles: partial ? Boolean(req.includeFiles) : req.includeFiles !== false,
          scrub: req.scrub ? makeScrubber(rules) : undefined,
        })
        if (req.scrub) audit(req.workspaceId, 'system', 'restore.scrubbed', { id, fieldsReplaced: scrubbed })
        log(`Prepared — ${size((await fs.promises.stat(importFile)).size)}${req.scrub ? `, ${scrubbed} field${scrubbed === 1 ? '' : 's'} scrubbed` : ''} in ${seconds(step)}`, 'success')
      }
      const convex = new ConvexAdmin(target.url, decrypt(target.admin_key_enc))
      step = Date.now()
      const rows = await convex.importZip(
        importFile,
        mode,
        (message) => {
          db().prepare('UPDATE restores SET confirm_message = ? WHERE id = ?').run(message, id)
        },
        log,
      )
      log(`Import completed — ${rows.toLocaleString('en')} documents written in ${seconds(step)}`, 'success')
      log(`Restore finished in ${seconds(t0)}`, 'success')
      db().prepare("UPDATE restores SET status = 'ok', rows_written = ?, finished_at = ? WHERE id = ?").run(rows, Date.now(), id)
      audit(req.workspaceId, 'system', 'restore.completed', { id, rows })
      await notify(req.workspaceId, { type: 'restore', status: 'ok', title: `Restore completed into ${target.name}`, details: [`Backup: ${copy.object_key}`, `Mode: ${req.mode}`, `Documents: ${rows}`, `By: ${req.actor}`] })
      await emailForRestore(req.workspaceId, id, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`✗ ${message}`, 'error')
      log(`Restore failed after ${seconds(t0)}`, 'error')
      db().prepare("UPDATE restores SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(message, Date.now(), id)
      audit(req.workspaceId, 'system', 'restore.failed', { id, error: message })
      await notify(req.workspaceId, { type: 'restore', status: 'failed', title: `Restore into ${target.name} failed`, details: [`Backup: ${copy.object_key}`, message] })
      await emailForRestore(req.workspaceId, id, false)
    } finally {
      restoring.delete(target.id)
      await fs.promises.rm(tmpFile, { force: true })
      await fs.promises.rm(`${tmpFile}.prepared.zip`, { force: true })
    }
  })()
  return id
}

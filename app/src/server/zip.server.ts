import { createHash, createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createInterface } from 'node:readline'
import { PassThrough, type Readable } from 'node:stream'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { isLosslessNumber, parse as parseLossless, stringify as stringifyLossless } from 'lossless-json'

// Helpers for Convex snapshot zips: `<table>/documents.jsonl` per table (components nest under
// `_components/<name>/`), `_tables/documents.jsonl` (name → table number), `_storage/` for files.

export type Manifest = {
  tables: { name: string; rows: number; bytes: number }[]
  files: { count: number; bytes: number }
  convexVersion?: string
}

function open(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => (err ? reject(err) : resolve(zip!))))
}

function entryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s!))))
}

async function* entries(file: string) {
  const zip = await open(file)
  const queue: yauzl.Entry[] = []
  let done = false
  let error: Error | null = null
  let wake: (() => void) | null = null
  zip.on('entry', (e: yauzl.Entry) => {
    queue.push(e)
    wake?.()
  })
  zip.on('end', () => {
    done = true
    wake?.()
  })
  zip.on('error', (e: Error) => {
    error = e
    wake?.()
  })
  zip.readEntry()
  while (true) {
    if (error) throw error
    const entry = queue.shift()
    if (entry) {
      yield { zip, entry }
      zip.readEntry()
      continue
    }
    if (done) return
    await new Promise<void>((r) => (wake = r))
    wake = null
  }
}

const TABLE_FILE = /^(.*)\/documents\.jsonl$/
const isUserTable = (name: string) => !name.split('/').pop()!.startsWith('_')

/** Lists tables (with row counts) and stored files in a snapshot zip. */
export async function inspectZip(file: string): Promise<Manifest> {
  const tables: Manifest['tables'] = []
  const files = { count: 0, bytes: 0 }
  for await (const { zip, entry } of entries(file)) {
    const m = TABLE_FILE.exec(entry.fileName)
    if (m && isUserTable(m[1])) {
      let rows = 0
      for await (const line of createInterface({ input: await entryStream(zip, entry), crlfDelay: Infinity })) if (line.trim()) rows++
      tables.push({ name: m[1], rows, bytes: entry.uncompressedSize })
    } else if (entry.fileName.startsWith('_storage/') && !entry.fileName.endsWith('.jsonl') && !entry.fileName.endsWith('/')) {
      files.count++
      files.bytes += entry.uncompressedSize
    }
  }
  tables.sort((a, b) => a.name.localeCompare(b.name))
  return { tables, files }
}

export async function sha256File(file: string) {
  const h = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

// ── Scrubbing ────────────────────────────────────────────────

export type ScrubMethod = 'email' | 'name' | 'phone' | 'redact' | 'null' | 'hash'
export type ScrubRule = { table: string; field: string; method: ScrubMethod }

export function makeScrubber(rules: ScrubRule[]) {
  // Deterministic within one restore (same input → same fake), unlinkable across restores.
  const salt = randomBytes(16)
  const h = (v: unknown) => createHmac('sha256', salt).update(isLosslessNumber(v) ? String(v) : JSON.stringify(v)).digest('hex')
  const fake: Record<ScrubMethod, (v: unknown) => unknown> = {
    email: (v) => `user-${h(v).slice(0, 10)}@example.com`,
    name: (v) => `Person ${h(v).slice(0, 6)}`,
    phone: (v) => `+1555${parseInt(h(v).slice(0, 8), 16).toString().padStart(7, '0').slice(0, 7)}`,
    redact: () => '[redacted]',
    null: () => null,
    hash: (v) => h(v).slice(0, 16),
  }
  const scrub = (table: string, doc: Record<string, unknown>) => {
    let changed = 0
    for (const rule of rules) {
      if (rule.table !== '*' && rule.table !== table) continue
      const path = rule.field.split('.')
      let obj: Record<string, unknown> | undefined = doc
      for (const key of path.slice(0, -1)) {
        const next: unknown = obj?.[key]
        obj = next && typeof next === 'object' && !Array.isArray(next) ? (next as Record<string, unknown>) : undefined
      }
      const last = path.at(-1)!
      if (obj && last in obj && obj[last] !== null && obj[last] !== undefined) {
        obj[last] = fake[rule.method](obj[last])
        changed++
      }
    }
    return changed
  }
  scrub.appliesTo = (table: string) => rules.some((r) => r.table === '*' || r.table === table)
  return scrub
}

/**
 * Writes a new snapshot zip from `input`, keeping only `tables` (if given; the `_tables` index and,
 * when `includeFiles`, `_storage` are always kept) and applying `scrub` to every user-table document.
 */
export async function rewriteZip(
  input: string,
  output: string,
  opts: { tables?: string[]; includeFiles?: boolean; scrub?: ReturnType<typeof makeScrubber> },
) {
  const out = new yazl.ZipFile()
  const done = new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(output)
    out.outputStream.pipe(ws).on('finish', resolve).on('error', reject)
  })
  const keep = opts.tables ? new Set(opts.tables) : null
  let scrubbed = 0
  for await (const { zip, entry } of entries(input)) {
    const name = entry.fileName
    if (name.endsWith('/')) continue
    const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : ''
    const m = TABLE_FILE.exec(name)
    const table = m?.[1]
    const isStorage = name.startsWith('_storage/')
    if (isStorage && opts.includeFiles === false) continue
    // Drop every file (documents, generated schema…) of user tables that weren't selected.
    if (keep && dir && isUserTable(dir) && !dir.endsWith('/_storage') && !keep.has(dir)) continue
    const source = await entryStream(zip, entry)
    const isIndex = name === '_tables/documents.jsonl' || name.endsWith('/_tables/documents.jsonl')
    if (keep && isIndex) {
      // The table index must list only the selected tables, or Convex treats the others as present-but-empty
      // and a "replace" import would wipe them.
      const prefix = name.slice(0, -'_tables/documents.jsonl'.length)
      const filtered = new PassThrough()
      out.addReadStream(filtered, name)
      for await (const line of createInterface({ input: source, crlfDelay: Infinity })) {
        if (!line.trim()) continue
        const entryName = (JSON.parse(line) as { name: string }).name
        if (entryName.startsWith('_') || keep.has(prefix + entryName)) filtered.write(line + '\n')
      }
      filtered.end()
    } else if (table && isUserTable(table) && opts.scrub?.appliesTo(table)) {
      // Lossless parse/stringify: Convex writes some floats as "123.0"; plain JSON would turn them into
      // integers, which Convex then reads as Int64 (e.g. "_creationTime doesn't match").
      const transformed = new PassThrough()
      out.addReadStream(transformed, name)
      for await (const line of createInterface({ input: source, crlfDelay: Infinity })) {
        if (!line.trim()) continue
        const doc = parseLossless(line) as Record<string, unknown>
        scrubbed += opts.scrub(table, doc)
        if (!transformed.write(stringifyLossless(doc) + '\n')) await new Promise((r) => transformed.once('drain', r))
      }
      transformed.end()
    } else {
      // yazl needs the stream consumed in order; buffer through a PassThrough.
      const pass = new PassThrough()
      out.addReadStream(pass, name)
      await new Promise<void>((resolve, reject) => source.pipe(pass).on('finish', resolve).on('error', reject))
    }
  }
  out.end()
  await done
  return { scrubbed }
}

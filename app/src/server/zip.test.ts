import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { inspectZip, makeScrubber, rewriteZip } from './zip.server'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'))
const snapshot = path.join(dir, 'snapshot.zip')
const lines = (docs: object[]) => docs.map((d) => JSON.stringify(d)).join('\n') + '\n'

beforeAll(async () => {
  // A miniature Convex snapshot export.
  const z = new yazl.ZipFile()
  z.addBuffer(Buffer.from(lines([{ name: 'users', id: 10001 }, { name: 'orders', id: 10002 }])), '_tables/documents.jsonl')
  z.addBuffer(
    Buffer.from(lines([
      { _id: 'u1', email: 'ada@example.org', name: 'Ada', profile: { phone: '+353 1 234' } },
      { _id: 'u2', email: 'bob@example.org', name: 'Bob', profile: { phone: null } },
      { _id: 'u3', email: 'ada@example.org', name: 'Ada again' },
    ]).replace('"_id":"u3"', '"_id":"u3","_creationTime":1791998758309.0')),
    'users/documents.jsonl',
  )
  z.addBuffer(Buffer.from(lines([{ _id: 'o1', total: 12 }])), 'orders/documents.jsonl')
  z.addBuffer(Buffer.from(lines([{ type: 'object' }])), 'users/generated_schema.jsonl')
  z.addBuffer(Buffer.from(lines([{ _id: 's1', sha256: 'x' }])), '_storage/documents.jsonl')
  z.addBuffer(Buffer.from('file-bytes'), '_storage/s1.blob')
  z.end()
  await new Promise((r) => z.outputStream.pipe(fs.createWriteStream(snapshot)).on('finish', r))
})

describe('inspectZip', () => {
  it('counts rows per user table and stored files', async () => {
    const m = await inspectZip(snapshot)
    expect(m.tables.map((t) => [t.name, t.rows])).toEqual([['orders', 1], ['users', 3]])
    expect(m.files).toEqual({ count: 1, bytes: 10 })
  })
})

describe('rewriteZip', () => {
  it('keeps only selected tables (plus the table index) and can drop files', async () => {
    const out = path.join(dir, 'partial.zip')
    await rewriteZip(snapshot, out, { tables: ['orders'], includeFiles: false })
    const m = await inspectZip(out)
    expect(m.tables.map((t) => t.name)).toEqual(['orders'])
    expect(m.files.count).toBe(0)
    // The table index must not mention dropped tables (Convex would wipe them on "replace").
    const dir2 = path.join(dir, 'partial')
    fs.mkdirSync(dir2)
    const { execSync } = await import('node:child_process')
    execSync(`cd ${dir2} && unzip -q ${out}`)
    expect(fs.readFileSync(path.join(dir2, '_tables/documents.jsonl'), 'utf8').trim()).toBe(JSON.stringify({ name: 'orders', id: 10002 }))
    expect(fs.existsSync(path.join(dir2, 'users'))).toBe(false)
  })

  it('scrubs fields consistently within one restore, including nested paths', async () => {
    const out = path.join(dir, 'scrubbed.zip')
    const scrub = makeScrubber([
      { table: '*', field: 'email', method: 'email' },
      { table: 'users', field: 'name', method: 'name' },
      { table: 'users', field: 'profile.phone', method: 'redact' },
    ])
    const { scrubbed } = await rewriteZip(snapshot, out, { scrub })
    expect(scrubbed).toBe(3 + 3 + 1) // null phone is left alone
    const extract = path.join(dir, 'x')
    fs.mkdirSync(extract)
    const { execSync } = await import('node:child_process')
    execSync(`cd ${extract} && unzip -q ${out}`)
    const users = fs.readFileSync(path.join(extract, 'users/documents.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(users[0].email).toMatch(/^user-[0-9a-f]{10}@example\.com$/)
    expect(users[0].email).toBe(users[2].email) // same input → same fake
    expect(users[1].email).not.toBe(users[0].email)
    expect(users[0].name).toMatch(/^Person [0-9a-f]{6}$/)
    expect(users[0].profile.phone).toBe('[redacted]')
    expect(users[1].profile.phone).toBeNull()
    expect(users[0]._id).toBe('u1') // ids untouched
    // Floats written as "N.0" by Convex must stay floats (else Convex reads them as Int64).
    expect(fs.readFileSync(path.join(extract, 'users/documents.jsonl'), 'utf8')).toContain('"_creationTime":1791998758309.0')
    expect(fs.readFileSync(path.join(extract, '_storage/s1.blob'), 'utf8')).toBe('file-bytes')
  })
})

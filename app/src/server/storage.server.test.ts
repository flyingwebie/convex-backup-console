import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDestination, type DestinationRow } from './storage.server'

function localDestination(root: string): DestinationRow {
  return { id: 'd1', name: 'local', kind: 'local', config: JSON.stringify({ root }), secret_enc: null }
}

describe('LocalDestination.verify', () => {
  let root: string
  let srcFile: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-console-dest-'))
    srcFile = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-console-src-'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(srcFile, { recursive: true, force: true })
  })

  it('passes when the stored file size matches the expected size', async () => {
    const file = path.join(srcFile, 'backup.zip')
    fs.writeFileSync(file, Buffer.alloc(1234, 1))
    const dest = openDestination(localDestination(root))
    await dest.put('instance/backup.zip', file)
    await expect(dest.verify('instance/backup.zip', 1234)).resolves.toBeUndefined()
  })

  it('throws a clear message when the stored file size does not match', async () => {
    const file = path.join(srcFile, 'backup.zip')
    fs.writeFileSync(file, Buffer.alloc(1234, 1))
    const dest = openDestination(localDestination(root))
    await dest.put('instance/backup.zip', file)
    await expect(dest.verify('instance/backup.zip', 9999)).rejects.toThrow(/size mismatch: expected 9999 bytes, found 1234/)
  })

  it('throws a clear message when the stored file is missing', async () => {
    const dest = openDestination(localDestination(root))
    await expect(dest.verify('instance/missing.zip', 10)).rejects.toThrow(/Could not find the stored file to verify it/)
  })
})

import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption'
import { decrypt, encrypt } from './crypto.server'
import { db } from './db.server'
import { workspaceSettings } from './workspace.server'

// One age X25519 key pair per workspace. The identity (private key) is stored encrypted with the
// master key so the console can restore; owners also export it to recover with the `age` CLI.

export function encryptionRecipient(workspaceId: string): string | null {
  return workspaceSettings(workspaceId).age_recipient
}

export async function createEncryptionKey(workspaceId: string): Promise<{ identity: string; recipient: string }> {
  if (encryptionRecipient(workspaceId)) throw new Error('This workspace already has an encryption key')
  const identity = await generateX25519Identity()
  const recipient = await identityToRecipient(identity)
  db()
    .prepare('UPDATE workspace_settings SET age_identity_enc = ?, age_recipient = ? WHERE workspace_id = ?')
    .run(encrypt(identity), recipient, workspaceId)
  return { identity, recipient }
}

export function encryptionIdentity(workspaceId: string): string {
  const enc = workspaceSettings(workspaceId).age_identity_enc
  if (!enc) throw new Error('No encryption key configured for this workspace')
  return decrypt(enc)
}

export async function encryptFile(workspaceId: string, input: string, output: string) {
  const recipient = encryptionRecipient(workspaceId)
  if (!recipient) throw new Error('No encryption key configured')
  const e = new Encrypter()
  e.addRecipient(recipient)
  const encrypted = await e.encrypt(Readable.toWeb(fs.createReadStream(input)) as ReadableStream<Uint8Array>)
  await (encrypted as unknown as WebReadableStream<Uint8Array>).pipeTo(
    Writable.toWeb(fs.createWriteStream(output)) as unknown as import('node:stream/web').WritableStream<Uint8Array>,
  )
}

export async function decryptStream(workspaceId: string, input: Readable): Promise<Readable> {
  const d = new Decrypter()
  d.addIdentity(encryptionIdentity(workspaceId))
  const out = await d.decrypt(Readable.toWeb(input) as ReadableStream<Uint8Array>)
  return Readable.fromWeb(out as unknown as WebReadableStream<Uint8Array>)
}

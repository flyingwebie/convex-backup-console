import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption'
import { decrypt, encrypt } from './crypto.server'
import { getSetting, setSetting } from './db.server'

// One age X25519 key pair per console. The identity (private key) is stored encrypted with the
// master key so the console can restore; operators also export it to recover with the `age` CLI.

export function encryptionRecipient(): string | null {
  return getSetting('age_recipient')
}

export async function createEncryptionKey(): Promise<{ identity: string; recipient: string }> {
  if (encryptionRecipient()) throw new Error('An encryption key already exists')
  const identity = await generateX25519Identity()
  const recipient = await identityToRecipient(identity)
  setSetting('age_identity_enc', encrypt(identity))
  setSetting('age_recipient', recipient)
  return { identity, recipient }
}

export function encryptionIdentity(): string {
  const enc = getSetting('age_identity_enc')
  if (!enc) throw new Error('No encryption key configured')
  return decrypt(enc)
}

export async function encryptFile(input: string, output: string) {
  const recipient = encryptionRecipient()
  if (!recipient) throw new Error('No encryption key configured')
  const e = new Encrypter()
  e.addRecipient(recipient)
  const encrypted = await e.encrypt(Readable.toWeb(fs.createReadStream(input)) as ReadableStream<Uint8Array>)
  await (encrypted as unknown as WebReadableStream<Uint8Array>).pipeTo(
    Writable.toWeb(fs.createWriteStream(output)) as unknown as import('node:stream/web').WritableStream<Uint8Array>,
  )
}

export async function decryptStream(input: Readable): Promise<Readable> {
  const d = new Decrypter()
  d.addIdentity(encryptionIdentity())
  const out = await d.decrypt(Readable.toWeb(input) as ReadableStream<Uint8Array>)
  return Readable.fromWeb(out as unknown as WebReadableStream<Uint8Array>)
}

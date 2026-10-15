import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, GetObjectLockConfigurationCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { decrypt } from './crypto.server'

export type S3Config = {
  endpoint?: string
  region: string
  bucket: string
  prefix?: string
  forcePathStyle?: boolean
  accessKeyId: string
  /** S3 Object Lock: every upload is immutable for `days` (bucket must have Object Lock enabled). */
  objectLock?: { mode: 'GOVERNANCE' | 'COMPLIANCE'; days: number }
  /** For the storage dashboard's cost estimate. */
  pricePerGbMonth?: number
}
export type LocalConfig = { root: string; pricePerGbMonth?: number }

export type PutResult = { versionId?: string; lockedUntil?: number }

export type DestinationRow = {
  id: string
  name: string
  kind: 's3' | 'local'
  config: string
  secret_enc: string | null
}

export interface Destination {
  test(): Promise<void>
  put(key: string, file: string): Promise<PutResult>
  delete(key: string, versionId?: string | null): Promise<void>
  get(key: string): Promise<Readable>
}

export function openDestination(row: DestinationRow): Destination {
  if (row.kind === 'local') return new LocalDestination(JSON.parse(row.config) as LocalConfig)
  return new S3Destination(JSON.parse(row.config) as S3Config, row.secret_enc ? decrypt(row.secret_enc) : '')
}

class S3Destination implements Destination {
  private client: S3Client
  constructor(
    private cfg: S3Config,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      region: cfg.region || 'auto',
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: cfg.forcePathStyle ?? false,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey },
    })
  }
  private fullKey(key: string) {
    return [this.cfg.prefix?.replace(/^\/+|\/+$/g, ''), key].filter(Boolean).join('/')
  }
  async test() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }))
    if (this.cfg.objectLock) {
      const lock = await this.client
        .send(new GetObjectLockConfigurationCommand({ Bucket: this.cfg.bucket }))
        .catch((err: unknown) => {
          throw new Error(
            `Object Lock isn't available on this bucket (${err instanceof Error ? err.name : 'error'}). It must be enabled when the bucket is created. ` +
              'Cloudflare R2 uses "Bucket locks" in its dashboard instead — leave Object Lock off here.',
          )
        })
      if (lock.ObjectLockConfiguration?.ObjectLockEnabled !== 'Enabled') throw new Error('Object Lock is not enabled on this bucket')
    }
  }
  async put(key: string, file: string): Promise<PutResult> {
    const lock = this.cfg.objectLock
    const lockedUntil = lock ? Date.now() + lock.days * 86_400_000 : undefined
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.cfg.bucket,
        Key: this.fullKey(key),
        Body: fs.createReadStream(file),
        ContentType: key.endsWith('.age') ? 'application/octet-stream' : 'application/zip',
        ...(lock && { ObjectLockMode: lock.mode, ObjectLockRetainUntilDate: new Date(lockedUntil!) }),
      },
      partSize: 16 * 1024 * 1024,
      queueSize: 4,
    })
    const res = await upload.done()
    return { versionId: 'VersionId' in res ? res.VersionId : undefined, lockedUntil }
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.fullKey(key) }))
    if (!res.Body) throw new Error('Empty object body')
    return res.Body as Readable
  }
  /** Deletes the exact version when known (permanent on versioned/locked buckets), else the key. */
  async delete(key: string, versionId?: string | null) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.fullKey(key), VersionId: versionId ?? undefined }))
  }
}

class LocalDestination implements Destination {
  constructor(private cfg: LocalConfig) {}
  private resolve(key: string) {
    const root = path.resolve(this.cfg.root)
    const target = path.resolve(root, key)
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid key')
    return target
  }
  async test() {
    await fs.promises.mkdir(this.cfg.root, { recursive: true })
    await fs.promises.access(this.cfg.root, fs.constants.W_OK)
  }
  async put(key: string, file: string) {
    const target = this.resolve(key)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await pipeline(fs.createReadStream(file), fs.createWriteStream(target + '.partial'))
    await fs.promises.rename(target + '.partial', target)
    return {}
  }
  async get(key: string) {
    const file = this.resolve(key)
    await fs.promises.access(file)
    return fs.createReadStream(file)
  }
  async delete(key: string) {
    await fs.promises.rm(this.resolve(key), { force: true })
  }
}

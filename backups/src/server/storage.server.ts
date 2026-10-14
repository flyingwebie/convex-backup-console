import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { decrypt } from './crypto.server'

export type S3Config = {
  endpoint?: string
  region: string
  bucket: string
  prefix?: string
  forcePathStyle?: boolean
  accessKeyId: string
}
export type LocalConfig = { root: string }

export type DestinationRow = {
  id: string
  name: string
  kind: 's3' | 'local'
  config: string
  secret_enc: string | null
}

export interface Destination {
  test(): Promise<void>
  put(key: string, file: string): Promise<void>
  delete(key: string): Promise<void>
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
  }
  async put(key: string, file: string) {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.cfg.bucket, Key: this.fullKey(key), Body: fs.createReadStream(file), ContentType: key.endsWith('.age') ? 'application/octet-stream' : 'application/zip' },
      partSize: 16 * 1024 * 1024,
      queueSize: 4,
    })
    await upload.done()
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.fullKey(key) }))
    if (!res.Body) throw new Error('Empty object body')
    return res.Body as Readable
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.fullKey(key) }))
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

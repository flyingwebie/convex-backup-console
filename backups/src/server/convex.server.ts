import fs from 'node:fs'
import { env } from './env.server'
// Minimal client for the Convex backend's admin HTTP API (the same endpoints `npx convex export` uses).

export type ExportState =
  | { _id: string; state: 'requested' | 'in_progress' | 'failed' }
  | { _id: string; state: 'completed'; start_ts: bigint; complete_ts: bigint }

export class ConvexAdmin {
  constructor(
    private readonly url: string,
    private readonly adminKey: string,
  ) {}

  private async fetch(path: string, init: RequestInit = {}) {
    const res = await fetch(new URL(path, this.url), {
      ...init,
      headers: { Authorization: `Convex ${this.adminKey}`, ...init.headers },
    }).catch((err: unknown) => {
      throw new Error(`Cannot reach ${this.url}: ${describeNetworkError(err)}`)
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`)
    }
    return res
  }

  async version(): Promise<string> {
    const res = await fetch(new URL('/version', this.url)).catch((err: unknown) => {
      throw new Error(`Cannot reach ${this.url}: ${describeNetworkError(err)}`)
    })
    if (!res.ok) throw new Error(`GET /version → ${res.status}`)
    return (await res.text()).trim()
  }

  async query(path: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const res = await this.fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
    })
    const json = (await res.json()) as { status: string; value?: unknown; errorMessage?: string }
    if (json.status !== 'success') throw new Error(json.errorMessage ?? `query ${path} failed`)
    return json.value
  }

  async latestExport(): Promise<ExportState | null> {
    const doc = (await this.query('_system/cli/exports:getLatest')) as Record<string, unknown> | null
    if (!doc) return null
    const state = doc.state as ExportState['state']
    if (state === 'completed') {
      return {
        _id: String(doc._id),
        state,
        start_ts: toBigInt(doc.start_ts),
        complete_ts: toBigInt(doc.complete_ts),
      }
    }
    return { _id: String(doc._id), state }
  }

  async requestExport(includeStorage: boolean) {
    await this.fetch(`/api/export/request/zip?includeStorage=${includeStorage}`, { method: 'POST' })
  }

  /** Requests an export and waits until a new one (different from `previousId`) settles. */
  async exportAndWait(includeStorage: boolean, opts: { timeoutMs?: number; pollMs?: number } = {}) {
    const previousId = (await this.latestExport())?._id
    await this.requestExport(includeStorage)
    const deadline = Date.now() + (opts.timeoutMs ?? 6 * 60 * 60 * 1000)
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 3000))
      const latest = await this.latestExport()
      if (!latest || latest._id === previousId) continue
      if (latest.state === 'completed') return latest
      if (latest.state === 'failed') throw new Error('Convex reported the export as failed')
    }
    throw new Error('Timed out waiting for the export to complete')
  }

  async downloadExport(startTs: bigint): Promise<Response> {
    return this.fetch(`/api/export/zip/${startTs}`)
  }

  /** Marks the export for deletion on the Convex side so it doesn't pile up in its exports bucket. */
  async expireExport(snapshotId: string, inMs = 60_000) {
    const ns = BigInt(Date.now() + inMs) * 1_000_000n
    await this.fetch(`/api/export/set_expiration/${snapshotId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // ns timestamps exceed Number.MAX_SAFE_INTEGER, so serialize by hand.
      body: `{"expirationTsNs":${ns}}`,
    })
  }

  /** Uploads a snapshot zip and runs the import; resolves with rows written. */
  async importZip(file: string, mode: ImportMode, onConfirm: (message: string) => void): Promise<number> {
    const { size } = await fs.promises.stat(file)
    // The backend rejects 10k+ parts; the CLI uses 5 MiB parts.
    const chunkSize = Math.max(8 * 1024 * 1024, Math.ceil(size / 9999))
    const { uploadToken } = (await (await this.fetch('/api/import/start_upload', { method: 'POST' })).json()) as {
      uploadToken: string
    }
    const partTokens: unknown[] = []
    let partNumber = 1
    for await (const chunk of fs.createReadStream(file, { highWaterMark: chunkSize })) {
      const res = await this.fetch(
        `/api/import/upload_part?uploadToken=${encodeURIComponent(uploadToken)}&partNumber=${partNumber++}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(chunk as Buffer) },
      )
      partTokens.push(await res.json())
    }
    const { importId } = (await (
      await this.fetch('/api/import/finish_upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import: { mode, format: 'zip' }, uploadToken, partTokens }),
      })
    ).json()) as { importId: string }

    let confirmed = false
    const deadline = Date.now() + 6 * 60 * 60 * 1000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      const doc = (await this.query('_system/cli/queryImport', { importId })) as { state: ImportState } | null
      const state = doc?.state
      if (!state) continue
      if (state.state === 'completed') return Number(toBigInt(state.num_rows_written))
      if (state.state === 'failed') throw new Error(`Import failed: ${state.error_message}`)
      if (state.state === 'waiting_for_confirmation' && !confirmed) {
        // The operator already typed the target name in the console; record what Convex asked.
        onConfirm(state.message_to_confirm ?? '')
        await this.fetch('/api/perform_import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ importId }),
        })
        confirmed = true
      }
    }
    throw new Error('Timed out waiting for the import to complete')
  }
}

export type ImportMode = 'replaceAll' | 'replace' | 'append' | 'requireEmpty'

export type ImportState =
  | { state: 'uploaded' }
  | { state: 'in_progress'; progress_message?: string }
  | { state: 'waiting_for_confirmation'; message_to_confirm?: string; require_manual_confirmation?: boolean }
  | { state: 'completed'; num_rows_written: number | bigint | Record<string, string> }
  | { state: 'failed'; error_message: string }

// Int64 values come back either as numbers or as Convex JSON `{ $integer: base64(le-int64) }`.
function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' || typeof value === 'string') return BigInt(value)
  if (value && typeof value === 'object' && '$integer' in value) {
    return Buffer.from(String((value as { $integer: string }).$integer), 'base64').readBigInt64LE(0)
  }
  throw new Error(`Unexpected int64 encoding: ${JSON.stringify(value)}`)
}

function describeNetworkError(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  return cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err))
}

// ── Convex Cloud ─────────────────────────────────────────────

export type DeployKeyInfo = { type: 'prod' | 'dev' | 'preview' | 'custom'; deploymentName: string }

/**
 * Validates a Convex Cloud deploy key. Only deployment-specific keys can back up a deployment:
 * `prod:<name>|…`, `dev:<name>|…`, `preview:<name>|…`. Project keys and preview-creation keys can't.
 */
export function parseDeployKey(key: string): DeployKeyInfo {
  const [prefix, secret] = key.split('|')
  if (!secret) throw new Error('That is not a Convex deploy key (expected "prod:your-deployment|…")')
  const parts = prefix.split(':')
  if (parts[0] === 'project') throw new Error('This is a project key. Generate a deploy key for a specific deployment instead.')
  if (parts[0] === 'preview' && parts.length === 3) throw new Error('This is a preview deploy key (it creates previews). Use a deploy key of one specific deployment.')
  if (parts.length !== 2 || !['prod', 'dev', 'preview', 'custom'].includes(parts[0])) {
    throw new Error('Unrecognised deploy key format (expected "prod:your-deployment|…" or "dev:…")')
  }
  return { type: parts[0] as DeployKeyInfo['type'], deploymentName: parts[1] }
}

/** Asks Convex which URL serves the deployment behind this deploy key (handles regions and custom domains). */
export async function resolveCloudUrl(deployKey: string): Promise<string> {
  const res = await fetch(`${env.provisionHost}/api/deployment/url_for_key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Convex-Client': 'convex-backup-console' },
    body: JSON.stringify({ deployKey }),
    signal: AbortSignal.timeout(15_000),
  }).catch((err: unknown) => {
    throw new Error(`Cannot reach Convex (${env.provisionHost}): ${err instanceof Error ? err.message : String(err)}`)
  })
  if (res.status === 401 || res.status === 403) throw new Error('Convex rejected this deploy key (revoked or mistyped?)')
  if (!res.ok) throw new Error(`Convex could not resolve the deployment URL (${res.status})`)
  const url = (await res.json()) as unknown
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('Unexpected response from Convex when resolving the deployment URL')
  return url.replace(/\/+$/, '')
}

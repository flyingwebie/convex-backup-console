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
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`)
    }
    return res
  }

  async version(): Promise<string> {
    const res = await fetch(new URL('/version', this.url))
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
}

// Int64 values come back either as numbers or as Convex JSON `{ $integer: base64(le-int64) }`.
function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' || typeof value === 'string') return BigInt(value)
  if (value && typeof value === 'object' && '$integer' in value) {
    return Buffer.from(String((value as { $integer: string }).$integer), 'base64').readBigInt64LE(0)
  }
  throw new Error(`Unexpected int64 encoding: ${JSON.stringify(value)}`)
}

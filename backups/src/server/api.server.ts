import { createHash, timingSafeEqual } from 'node:crypto'
import { ensureBooted } from './boot.server'
import { db } from './db.server'

export type ApiContext = { workspaceId: string; tokenName: string; scope: 'read' | 'run' }

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export const apiError = (status: number, message: string) => json({ error: message }, status)

/** Authenticates `Authorization: Bearer cbc_<prefix>_<secret>`; returns the token's workspace and scope. */
export async function apiAuth(request: Request, need: 'read' | 'run'): Promise<ApiContext | Response> {
  await ensureBooted()
  const token = /^Bearer\s+(cbc_[A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return apiError(401, 'Missing bearer token')
  const prefix = token.split('_')[1]
  const row = db()
    .prepare(
      `SELECT t.id, t.workspace_id, t.name, t.hash, t.scope, t.expires_at, s.api_enabled FROM api_tokens t
       JOIN workspace_settings s ON s.workspace_id = t.workspace_id
       WHERE t.prefix = ? AND t.revoked_at IS NULL AND s.deleted_at IS NULL`,
    )
    .get(prefix) as { id: string; workspace_id: string; name: string; hash: string; scope: 'read' | 'run'; expires_at: number | null; api_enabled: number } | undefined
  const hash = createHash('sha256').update(token).digest()
  if (!row || !timingSafeEqual(Buffer.from(row.hash, 'hex'), hash)) return apiError(401, 'Invalid token')
  if (row.expires_at && row.expires_at < Date.now()) return apiError(401, 'Token expired')
  // Workspace switch (Settings → API tokens) that turns off the REST API and the GitHub Action.
  if (!row.api_enabled) return apiError(403, 'API access is disabled for this workspace')
  if (need === 'run' && row.scope !== 'run') return apiError(403, 'This token is read-only')
  db().prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id)
  return { workspaceId: row.workspace_id, tokenName: row.name, scope: row.scope }
}

export { json }

// Cloudflare R2 auto-provisioning: verify a one-time setup token, create the bucket, optionally lock it,
// then mint a brand-new account token scoped to only that bucket and derive S3 credentials from it.
// The setup token is held in memory for this request only — never persisted, logged, or returned.
import { createHash } from 'node:crypto'
import { buildR2LockRule, r2BucketResourceKey, r2Endpoint, r2TokenName, type ProvisionStep, type R2Jurisdiction } from './helpers'

const API = 'https://api.cloudflare.com/client/v4'

/**
 * Derives S3-compatible credentials from a Cloudflare API token: the access key id is the token id,
 * the secret is the hex SHA-256 digest of the token value. See "Get S3 API credentials from an API token"
 * in the Cloudflare R2 docs. Kept server-side only (node:crypto).
 */
export function deriveR2S3Credentials(tokenId: string, tokenValue: string): { accessKeyId: string; secretAccessKey: string } {
  return { accessKeyId: tokenId, secretAccessKey: createHash('sha256').update(tokenValue).digest('hex') }
}

export type R2ProvisionInput = {
  accountId: string
  setupToken: string
  bucket: string
  jurisdiction: R2Jurisdiction
  locationHint?: string
  lockDays?: number
  prefix?: string
}

export type R2ProvisionResult = {
  endpoint: string
  region: 'auto'
  bucket: string
  prefix?: string
  accessKeyId: string
  secretAccessKey: string
  note?: string
  /** Rolls back everything this request created (the minted token, and the bucket if this request created it). */
  rollback: () => Promise<void>
}

type CfResponse<T> = { success: boolean; result: T | null; errors: { code: number; message: string }[] }

async function cf<T>(path: string, token: string, init: { method?: string; body?: unknown; extraHeaders?: Record<string, string> } = {}): Promise<CfResponse<T>> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.extraHeaders,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const json = (await res.json().catch(() => ({ success: false, result: null, errors: [{ code: res.status, message: res.statusText }] }))) as CfResponse<T>
  return json
}

function cfErrorMessage(json: CfResponse<unknown>, fallback: string) {
  return json.errors?.[0]?.message || fallback
}

/** Deletes the token this request minted, or the bucket this request created. Never throws past its own step. */
async function rollbackR2(
  steps: ProvisionStep[],
  setupToken: string,
  accountId: string,
  created: { tokenId?: string; tokenScope?: 'account' | 'user'; bucketCreated?: boolean; bucket: string; jurisdiction: R2Jurisdiction },
) {
  if (created.tokenId) {
    const path = created.tokenScope === 'user' ? `/user/tokens/${created.tokenId}` : `/accounts/${accountId}/tokens/${created.tokenId}`
    const res = await cf(path, setupToken, { method: 'DELETE' }).catch((err: unknown) => ({ success: false, errors: [{ code: 0, message: String(err) }], result: null }))
    steps.push({
      id: 'rollback-token',
      label: 'Roll back: revoke the minted R2 token',
      status: res.success ? 'rolled_back' : 'failed',
      detail: res.success ? undefined : cfErrorMessage(res as CfResponse<unknown>, 'Could not revoke the minted token — revoke it manually'),
    })
  }
  if (created.bucketCreated) {
    const jurisdictionHeader = created.jurisdiction !== 'default' ? { 'cf-r2-jurisdiction': created.jurisdiction } : undefined
    const res = await cf(`/accounts/${accountId}/r2/buckets/${created.bucket}`, setupToken, { method: 'DELETE', extraHeaders: jurisdictionHeader }).catch(
      (err: unknown) => ({ success: false, errors: [{ code: 0, message: String(err) }], result: null }),
    )
    steps.push({
      id: 'rollback-bucket',
      label: 'Roll back: delete the bucket this request created',
      status: res.success ? 'rolled_back' : 'failed',
      detail: res.success ? undefined : cfErrorMessage(res as CfResponse<unknown>, 'Could not delete the bucket — it may not be empty, remove it manually'),
    })
  }
}

export async function provisionR2(input: R2ProvisionInput, steps: ProvisionStep[]): Promise<R2ProvisionResult> {
  const { accountId, setupToken, bucket, jurisdiction } = input
  const jurisdictionHeader = jurisdiction !== 'default' ? { 'cf-r2-jurisdiction': jurisdiction } : undefined
  const created: { tokenId?: string; tokenScope?: 'account' | 'user'; bucketCreated?: boolean; bucket: string; jurisdiction: R2Jurisdiction } = { bucket, jurisdiction }

  // 1. Verify the setup token. Account-owned tokens use /accounts/{id}/tokens/verify; user tokens use /user/tokens/verify.
  const accountVerify = await cf<{ status: string }>(`/accounts/${accountId}/tokens/verify`, setupToken)
  let verified = accountVerify.success && accountVerify.result?.status === 'active'
  if (!verified) {
    const userVerify = await cf<{ status: string }>('/user/tokens/verify', setupToken)
    verified = userVerify.success && userVerify.result?.status === 'active'
    if (!verified) {
      steps.push({ id: 'verify', label: 'Verify setup token', status: 'failed', detail: cfErrorMessage(userVerify, 'The setup token was rejected or is not active') })
      throw new Error('The setup token could not be verified against your Cloudflare account')
    }
  }
  steps.push({ id: 'verify', label: 'Verify setup token', status: 'ok' })

  // 2. Create the bucket (or reuse an existing one this token can see).
  const createRes = await cf<{ name: string }>(`/accounts/${accountId}/r2/buckets`, setupToken, {
    method: 'POST',
    body: { name: bucket, locationHint: input.locationHint || undefined },
    extraHeaders: jurisdictionHeader,
  })
  if (createRes.success) {
    created.bucketCreated = true
    steps.push({ id: 'bucket', label: `Create bucket "${bucket}"`, status: 'ok' })
  } else {
    const msg = cfErrorMessage(createRes, '')
    const alreadyExists = /already exist|already own|10004/i.test(msg) || createRes.errors?.some((e) => e.code === 10004)
    if (!alreadyExists) {
      steps.push({ id: 'bucket', label: `Create bucket "${bucket}"`, status: 'failed', detail: msg || 'Unknown error creating the bucket' })
      throw new Error(`Could not create the R2 bucket: ${msg || 'unknown error'}`)
    }
    const check = await cf(`/accounts/${accountId}/r2/buckets/${bucket}`, setupToken, { extraHeaders: jurisdictionHeader })
    if (!check.success) {
      steps.push({ id: 'bucket', label: `Create bucket "${bucket}"`, status: 'failed', detail: 'The bucket already exists and is not accessible with this token' })
      throw new Error(`Bucket "${bucket}" already exists and this token can't access it — pick another name or grant access`)
    }
    steps.push({ id: 'bucket', label: `Create bucket "${bucket}"`, status: 'ok', detail: 'Already existed — reusing it' })
  }

  try {
    // 3. Optional bucket lock (R2's retention mechanism; not S3 Object Lock).
    if (input.lockDays) {
      const lockRes = await cf(`/accounts/${accountId}/r2/buckets/${bucket}/lock`, setupToken, {
        method: 'PUT',
        body: buildR2LockRule(input.lockDays),
        extraHeaders: jurisdictionHeader,
      })
      if (!lockRes.success) {
        steps.push({ id: 'lock', label: `Lock objects for ${input.lockDays} days`, status: 'failed', detail: cfErrorMessage(lockRes, 'Could not set the bucket lock') })
        throw new Error(`Could not set the bucket lock: ${cfErrorMessage(lockRes, 'unknown error')}`)
      }
      steps.push({ id: 'lock', label: `Lock objects for ${input.lockDays} days`, status: 'ok' })
    } else {
      steps.push({ id: 'lock', label: 'Bucket lock', status: 'skipped' })
    }

    // 4. Find the bucket-scoped R2 permission groups.
    const groups = await cf<{ id: string; name: string }[]>(`/accounts/${accountId}/tokens/permission_groups?scope=com.cloudflare.edge.r2.bucket`, setupToken)
    const writeGroup = groups.result?.find((g) => /storage bucket item write/i.test(g.name))
    const readGroup = groups.result?.find((g) => /storage bucket item read/i.test(g.name))
    if (!groups.success || !writeGroup || !readGroup) {
      steps.push({ id: 'permissions', label: 'Look up R2 bucket permission groups', status: 'failed', detail: cfErrorMessage(groups, 'Could not find the R2 bucket item permission groups') })
      throw new Error('Could not look up the R2 bucket permission groups needed to mint a scoped token')
    }
    steps.push({ id: 'permissions', label: 'Look up R2 bucket permission groups', status: 'ok' })

    // 5. Mint a new token scoped to exactly this bucket. Try an account-owned token first, then a user token.
    const resourceKey = r2BucketResourceKey(accountId, bucket, jurisdiction)
    const tokenBody = {
      name: r2TokenName(bucket),
      policies: [{ effect: 'allow', permission_groups: [{ id: writeGroup.id }, { id: readGroup.id }], resources: { [resourceKey]: '*' } }],
    }
    let tokenRes = await cf<{ id: string; value: string }>(`/accounts/${accountId}/tokens`, setupToken, { method: 'POST', body: tokenBody })
    let scope: 'account' | 'user' = 'account'
    if (!tokenRes.success) {
      const userRes = await cf<{ id: string; value: string }>('/user/tokens', setupToken, { method: 'POST', body: tokenBody })
      if (userRes.success) {
        tokenRes = userRes
        scope = 'user'
      }
    }
    if (!tokenRes.success || !tokenRes.result) {
      steps.push({ id: 'token', label: 'Mint a scoped access token', status: 'failed', detail: cfErrorMessage(tokenRes, 'Could not create a scoped token') })
      throw new Error(`Could not mint a scoped R2 token: ${cfErrorMessage(tokenRes, 'unknown error')}`)
    }
    created.tokenId = tokenRes.result.id
    created.tokenScope = scope
    steps.push({ id: 'token', label: 'Mint a scoped access token', status: 'ok', detail: scope === 'account' ? 'Account-owned token' : 'User token (fallback)' })

    // 6. Derive S3 credentials from the minted token.
    const { accessKeyId, secretAccessKey } = deriveR2S3Credentials(tokenRes.result.id, tokenRes.result.value)
    steps.push({ id: 'credentials', label: 'Derive S3 credentials', status: 'ok' })

    return {
      endpoint: r2Endpoint(accountId, jurisdiction),
      region: 'auto',
      bucket,
      prefix: input.prefix,
      accessKeyId,
      secretAccessKey,
      note: input.lockDays ? `Bucket-locked for ${input.lockDays} days (Cloudflare bucket lock, not S3 Object Lock)` : undefined,
      rollback: () => rollbackR2(steps, setupToken, accountId, created),
    }
  } catch (err) {
    await rollbackR2(steps, setupToken, accountId, created)
    throw err
  }
}

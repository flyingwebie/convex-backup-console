// Pure, isomorphic helpers for the "Create bucket for me" auto-provisioning flows (Cloudflare R2 + AWS S3).
// No network calls, no Node built-ins, no secrets — safe to unit test and to import from client UI code.
// (Credential derivation that needs node:crypto lives in r2.server.ts, which is server-only.)

export type ProvisionStepStatus = 'ok' | 'skipped' | 'failed' | 'rolled_back'
export type ProvisionStep = {
  id: string
  label: string
  status: ProvisionStepStatus
  detail?: string
  /** Wall-clock time this step took, in ms, measured from the previous step's push. Additive —
   * populated by `withStepTimings` in index.server.ts, not by the provider modules themselves, so
   * r2.server.ts/aws.server.ts don't need to know about it. Used by the wizard's progress view to
   * show a per-step duration once the step completes. */
  ms?: number
}

export type Provider = 'r2' | 'aws'

/**
 * Wraps a `ProvisionStep[]` so every `.push()` records how long elapsed since the previous push (or
 * since this wrapper was created) and stamps it onto each pushed step as `ms`. Purely additive
 * instrumentation — the provider modules keep calling `steps.push({...})` exactly as before; they
 * never set `ms` themselves.
 */
export function withStepTimings(steps: ProvisionStep[]): ProvisionStep[] {
  let last = Date.now()
  const originalPush = steps.push.bind(steps)
  steps.push = (...items: ProvisionStep[]) => {
    const now = Date.now()
    for (const item of items) {
      if (item.ms === undefined) item.ms = now - last
    }
    last = now
    return originalPush(...items)
  }
  return steps
}

/** Validates a bucket name against the target provider's naming rules. Returns an error message, or null when valid. */
export function validateBucketName(provider: Provider, name: string): string | null {
  if (name.length < 3 || name.length > 63) return 'Must be 3–63 characters'
  if (provider === 'aws') {
    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return 'Use lowercase letters, numbers, dots and hyphens; start and end with a letter or number'
    if (name.includes('..')) return "Can't contain two dots in a row"
    if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return "Can't look like an IP address"
    if (name.startsWith('xn--')) return "Can't start with \"xn--\""
    if (name.endsWith('-s3alias') || name.endsWith('--ol-s3')) return 'Reserved suffix for an AWS-managed bucket'
    return null
  }
  // Cloudflare R2: lowercase letters, numbers and hyphens only (no dots).
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) return 'Use lowercase letters, numbers and hyphens; start and end with a letter or number'
  return null
}

/** Sanitizes a bucket name into a safe suffix for a generated IAM user / token name. */
function sanitizeSuffix(bucket: string, maxLen: number) {
  return bucket.replace(/[^a-zA-Z0-9+=,.@_-]/g, '-').slice(0, maxLen)
}

/** IAM user names allow up to 64 chars of [\w+=,.@-]. */
export function iamUserName(bucket: string): string {
  const prefix = 'convex-backup-'
  return prefix + sanitizeSuffix(bucket, 64 - prefix.length)
}

/** Cloudflare account-owned token names have a generous limit; keep it descriptive but bounded. */
export function r2TokenName(bucket: string): string {
  const prefix = 'convex-backup-'
  return prefix + sanitizeSuffix(bucket, 90)
}

/** The least-privilege inline policy attached to the IAM user this flow creates, scoped to one bucket. */
export function buildAwsBucketPolicy(bucket: string) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'BucketLevel',
        Effect: 'Allow',
        Action: ['s3:ListBucket', 's3:GetBucketLocation', 's3:GetBucketObjectLockConfiguration', 's3:GetBucketVersioning'],
        Resource: `arn:aws:s3:::${bucket}`,
      },
      {
        Sid: 'ObjectLevel',
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject', 's3:GetObjectVersion', 's3:DeleteObjectVersion', 's3:PutObjectRetention', 's3:GetObjectRetention'],
        Resource: `arn:aws:s3:::${bucket}/*`,
      },
    ],
  } as const
}

/** Shown to the user so they can create the one-time setup IAM user/key with exactly enough rights. */
export function buildAwsSetupPolicy() {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'SetupBucket',
        Effect: 'Allow',
        Action: ['s3:CreateBucket', 's3:PutBucketPublicAccessBlock', 's3:PutBucketVersioning', 's3:PutEncryptionConfiguration', 's3:GetBucketLocation', 's3:HeadBucket'],
        Resource: 'arn:aws:s3:::*',
      },
      {
        Sid: 'SetupIam',
        Effect: 'Allow',
        Action: ['iam:CreateUser', 'iam:PutUserPolicy', 'iam:CreateAccessKey', 'iam:DeleteAccessKey', 'iam:DeleteUserPolicy', 'iam:DeleteUser', 'iam:TagUser'],
        Resource: 'arn:aws:iam::*:user/convex-backup/*',
      },
      { Sid: 'SetupIdentity', Effect: 'Allow', Action: ['sts:GetCallerIdentity'], Resource: '*' },
    ],
  } as const
}

export type R2Jurisdiction = 'default' | 'eu' | 'fedramp'

/** The resource key used to scope a Cloudflare account token to exactly one R2 bucket. */
export function r2BucketResourceKey(accountId: string, bucket: string, jurisdiction: R2Jurisdiction = 'default'): string {
  return `com.cloudflare.edge.r2.bucket.${accountId}_${jurisdiction}_${bucket}`
}

/** The S3-compatible endpoint for an R2 account, per jurisdiction. */
export function r2Endpoint(accountId: string, jurisdiction: R2Jurisdiction = 'default'): string {
  const host = jurisdiction === 'default' ? 'r2.cloudflarestorage.com' : `${jurisdiction}.r2.cloudflarestorage.com`
  return `https://${accountId}.${host}`
}

/** Cloudflare's bucket-lock "Age" rule body for a day-based retention period. */
export function buildR2LockRule(days: number) {
  return { rules: [{ id: 'convex-backup-lock', enabled: true, condition: { type: 'Age', maxAgeSeconds: days * 86_400 } }] }
}

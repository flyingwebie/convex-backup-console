// AWS S3 auto-provisioning: verify a one-time setup IAM key, create the bucket (with the requested
// Object Lock / encryption / public-access settings), create a least-privilege IAM user + access key
// scoped to only that bucket. The setup key is held in memory for this request only.
import {
  CreateAccessKeyCommand,
  CreateUserCommand,
  DeleteAccessKeyCommand,
  DeleteUserCommand,
  DeleteUserPolicyCommand,
  IAMClient,
  PutUserPolicyCommand,
} from '@aws-sdk/client-iam'
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  DeleteBucketCommand,
  PutBucketEncryptionCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'
import { buildAwsBucketPolicy, iamUserName, type ProvisionStep } from './helpers'

export type AwsProvisionInput = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  bucket: string
  prefix?: string
  lock?: { mode: 'GOVERNANCE' | 'COMPLIANCE'; days: number }
}

export type AwsProvisionResult = {
  region: string
  bucket: string
  prefix?: string
  accessKeyId: string
  secretAccessKey: string
  objectLock?: { mode: 'GOVERNANCE' | 'COMPLIANCE'; days: number }
  note?: string
  /** Rolls back everything this request created (the access key, user policy, user, and the bucket if empty and newly created). */
  rollback: () => Promise<void>
}

function clients(input: AwsProvisionInput) {
  const credentials = { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey, sessionToken: input.sessionToken }
  return {
    s3: new S3Client({ region: input.region, credentials }),
    iam: new IAMClient({ region: input.region, credentials }),
    sts: new STSClient({ region: input.region, credentials }),
  }
}

function errName(err: unknown) {
  return err instanceof Error ? err.name : 'Error'
}
function errMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

async function rollbackAws(
  steps: ProvisionStep[],
  { iam, s3 }: ReturnType<typeof clients>,
  created: { userName?: string; accessKeyId?: string; policyPut?: boolean; bucketCreated?: boolean; bucket: string },
) {
  if (created.accessKeyId && created.userName) {
    try {
      await iam.send(new DeleteAccessKeyCommand({ UserName: created.userName, AccessKeyId: created.accessKeyId }))
      steps.push({ id: 'rollback-key', label: 'Roll back: delete the minted access key', status: 'rolled_back' })
    } catch (err) {
      steps.push({ id: 'rollback-key', label: 'Roll back: delete the minted access key', status: 'failed', detail: errMessage(err) })
    }
  }
  if (created.policyPut && created.userName) {
    try {
      await iam.send(new DeleteUserPolicyCommand({ UserName: created.userName, PolicyName: 'convex-backup-bucket-access' }))
      steps.push({ id: 'rollback-policy', label: 'Roll back: remove the IAM user policy', status: 'rolled_back' })
    } catch (err) {
      steps.push({ id: 'rollback-policy', label: 'Roll back: remove the IAM user policy', status: 'failed', detail: errMessage(err) })
    }
  }
  if (created.userName) {
    try {
      await iam.send(new DeleteUserCommand({ UserName: created.userName }))
      steps.push({ id: 'rollback-user', label: 'Roll back: delete the IAM user', status: 'rolled_back' })
    } catch (err) {
      steps.push({ id: 'rollback-user', label: 'Roll back: delete the IAM user', status: 'failed', detail: errMessage(err) })
    }
  }
  if (created.bucketCreated) {
    try {
      await s3.send(new DeleteBucketCommand({ Bucket: created.bucket }))
      steps.push({ id: 'rollback-bucket', label: 'Roll back: delete the bucket this request created', status: 'rolled_back' })
    } catch (err) {
      steps.push({
        id: 'rollback-bucket',
        label: 'Roll back: delete the bucket this request created',
        status: 'failed',
        detail: `Could not delete the bucket (it may not be empty): ${errMessage(err)}`,
      })
    }
  }
}

export async function provisionAws(input: AwsProvisionInput, steps: ProvisionStep[]): Promise<AwsProvisionResult> {
  const c = clients(input)
  const created: { userName?: string; accessKeyId?: string; policyPut?: boolean; bucketCreated?: boolean; bucket: string } = { bucket: input.bucket }

  // 1. Verify the setup key.
  try {
    const id = await c.sts.send(new GetCallerIdentityCommand({}))
    steps.push({ id: 'verify', label: 'Verify setup credentials', status: 'ok', detail: id.Account ? `AWS account ${id.Account}` : undefined })
  } catch (err) {
    steps.push({ id: 'verify', label: 'Verify setup credentials', status: 'failed', detail: errMessage(err) })
    throw new Error(`The setup access key was rejected: ${errMessage(err)}`)
  }

  // 2. Create the bucket.
  try {
    await c.s3.send(
      new CreateBucketCommand({
        Bucket: input.bucket,
        ObjectLockEnabledForBucket: Boolean(input.lock) || undefined,
        ...(input.region !== 'us-east-1' ? { CreateBucketConfiguration: { LocationConstraint: input.region as never } } : {}),
      }),
    )
    created.bucketCreated = true
    steps.push({ id: 'bucket', label: `Create bucket "${input.bucket}"`, status: 'ok' })
  } catch (err) {
    if (err instanceof BucketAlreadyOwnedByYou || errName(err) === 'BucketAlreadyOwnedByYou') {
      steps.push({ id: 'bucket', label: `Create bucket "${input.bucket}"`, status: 'ok', detail: 'Already existed in this account — reusing it' })
    } else {
      steps.push({ id: 'bucket', label: `Create bucket "${input.bucket}"`, status: 'failed', detail: errMessage(err) })
      throw new Error(
        errName(err) === 'BucketAlreadyExists'
          ? `Bucket "${input.bucket}" is already taken by another AWS account — bucket names are global, pick another name`
          : `Could not create the bucket: ${errMessage(err)}`,
      )
    }
  }

  try {
    // 3. Lock the bucket down from public access and turn on default encryption.
    await c.s3.send(
      new PutPublicAccessBlockCommand({
        Bucket: input.bucket,
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
      }),
    )
    steps.push({ id: 'public-access-block', label: 'Block public access', status: 'ok' })

    await c.s3.send(
      new PutBucketEncryptionCommand({
        Bucket: input.bucket,
        ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      }),
    )
    steps.push({ id: 'encryption', label: 'Enable default encryption (SSE-S3)', status: 'ok' })

    if (input.lock && created.bucketCreated) {
      steps.push({ id: 'lock', label: `Enable Object Lock (${input.lock.mode}, ${input.lock.days} days)`, status: 'ok' })
    } else if (input.lock) {
      steps.push({ id: 'lock', label: 'Object Lock', status: 'skipped', detail: 'Object Lock can only be enabled when a bucket is created, not on an existing bucket' })
    } else {
      steps.push({ id: 'lock', label: 'Object Lock', status: 'skipped' })
    }

    // 4. Create a least-privilege IAM user + inline policy + access key, scoped to only this bucket.
    const userName = iamUserName(input.bucket)
    await c.iam.send(new CreateUserCommand({ UserName: userName, Path: '/convex-backup/', Tags: [{ Key: 'purpose', Value: 'convex-backup-console' }] }))
    created.userName = userName
    steps.push({ id: 'iam-user', label: `Create IAM user "${userName}"`, status: 'ok' })

    await c.iam.send(
      new PutUserPolicyCommand({ UserName: userName, PolicyName: 'convex-backup-bucket-access', PolicyDocument: JSON.stringify(buildAwsBucketPolicy(input.bucket)) }),
    )
    created.policyPut = true
    steps.push({ id: 'iam-policy', label: 'Attach least-privilege bucket policy', status: 'ok' })

    const key = await c.iam.send(new CreateAccessKeyCommand({ UserName: userName }))
    if (!key.AccessKey?.AccessKeyId || !key.AccessKey.SecretAccessKey) throw new Error('AWS did not return an access key')
    created.accessKeyId = key.AccessKey.AccessKeyId
    steps.push({ id: 'access-key', label: 'Create access key', status: 'ok' })

    return {
      region: input.region,
      bucket: input.bucket,
      prefix: input.prefix,
      accessKeyId: key.AccessKey.AccessKeyId,
      secretAccessKey: key.AccessKey.SecretAccessKey,
      objectLock: input.lock && created.bucketCreated ? input.lock : undefined,
      note: 'A new IAM access key can take up to ~30s to become usable (eventual consistency) — the first access check retries automatically.',
      rollback: () => rollbackAws(steps, c, created),
    }
  } catch (err) {
    await rollbackAws(steps, c, created)
    throw err
  }
}

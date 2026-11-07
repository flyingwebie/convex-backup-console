// Orchestrates "Create bucket for me": runs the provider-specific flow, verifies the result works with
// the existing destination test (retrying for AWS's eventual-consistency window), rolls back everything
// this request created on failure, then saves the destination exactly like the manual flow.
// Setup credentials passed in `input` are used only for the duration of this call — never stored, logged,
// put in the audit entry, or included in any error message surfaced below.
import { randomUUID } from 'node:crypto'
import { audit, db } from '../db.server'
import { encrypt } from '../crypto.server'
import { openDestination, type DestinationRow, type S3Config } from '../storage.server'
import { provisionAws, type AwsProvisionInput } from './aws.server'
import { provisionR2, type R2ProvisionInput } from './r2.server'
import type { ProvisionStep } from './helpers'
import { withStepTimings } from './helpers'

export type { ProvisionStep } from './helpers'

export type ProvisionInput =
  | { provider: 'r2'; name: string; prefix?: string } & Omit<R2ProvisionInput, 'prefix'>
  | { provider: 'aws'; name: string; prefix?: string } & Omit<AwsProvisionInput, 'prefix'>

export type ProvisionOutcome =
  | { ok: true; destinationId: string; steps: ProvisionStep[]; revokeNote: string }
  | { ok: false; steps: ProvisionStep[]; error: string }

function uniqueNameError(err: unknown): string {
  if (String(err).includes('UNIQUE')) return 'A destination with that name already exists in this workspace'
  return err instanceof Error ? err.message : String(err)
}

/** Verifies the new destination works, retrying for ~30s — new AWS IAM keys are eventually consistent. */
async function testWithBackoff(row: DestinationRow, steps: ProvisionStep[]) {
  const delays = [1000, 2000, 3000, 5000, 8000, 13000] // ~32s total
  for (let attempt = 0; ; attempt++) {
    try {
      await openDestination(row).test()
      steps.push({ id: 'test', label: 'Verify the new destination', status: 'ok', detail: attempt > 0 ? `Succeeded after ${attempt + 1} attempts` : undefined })
      return
    } catch (err) {
      if (attempt >= delays.length) {
        steps.push({ id: 'test', label: 'Verify the new destination', status: 'failed', detail: err instanceof Error ? err.message : String(err) })
        throw new Error(`The new destination didn't pass its access check: ${err instanceof Error ? err.message : String(err)}`)
      }
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }
  }
}

export async function provisionDestination(workspaceId: string, actorEmail: string, input: ProvisionInput): Promise<ProvisionOutcome> {
  const steps: ProvisionStep[] = withStepTimings([])
  let rollback: (() => Promise<void>) | undefined
  try {
    let config: S3Config
    let secretAccessKey: string
    let revokeNote: string

    if (input.provider === 'r2') {
      const { provider: _p, name: _n, ...r2Input } = input
      const result = await provisionR2(r2Input, steps)
      rollback = result.rollback
      config = {
        endpoint: result.endpoint,
        region: result.region,
        bucket: result.bucket,
        prefix: result.prefix,
        accessKeyId: result.accessKeyId,
        // objectLock stays undefined for R2 — it uses bucket-level locks, not S3 Object Lock.
      }
      secretAccessKey = result.secretAccessKey
      revokeNote = 'You can safely revoke or delete the one-time setup token now — the console only kept the newly minted, bucket-scoped token.'
    } else {
      const { provider: _p, name: _n, ...awsInput } = input
      const result = await provisionAws(awsInput, steps)
      rollback = result.rollback
      config = {
        region: result.region,
        bucket: result.bucket,
        prefix: result.prefix,
        accessKeyId: result.accessKeyId,
        objectLock: result.objectLock,
      }
      secretAccessKey = result.secretAccessKey
      revokeNote = 'You can safely delete or deactivate the one-time setup access key now — the console only kept the newly created, bucket-scoped IAM key.'
    }

    const id = randomUUID()
    const row: DestinationRow = { id, name: input.name, kind: 's3', config: JSON.stringify(config), secret_enc: encrypt(secretAccessKey) }

    try {
      await testWithBackoff(row, steps)
    } catch (err) {
      if (rollback) await rollback()
      throw err
    }

    try {
      db()
        .prepare('INSERT INTO destinations (id, workspace_id, name, kind, config, secret_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(row.id, workspaceId, row.name, row.kind, row.config, row.secret_enc, Date.now())
    } catch (err) {
      if (rollback) await rollback()
      throw new Error(uniqueNameError(err))
    }

    audit(workspaceId, actorEmail, 'destination.provisioned', { id, name: input.name, provider: input.provider, bucket: config.bucket, region: config.region })
    return { ok: true, destinationId: id, steps, revokeNote }
  } catch (err) {
    return { ok: false, steps, error: err instanceof Error ? err.message : String(err) }
  }
}

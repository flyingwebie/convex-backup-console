import { useServerFn } from '@tanstack/react-start'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, CloudCog, ExternalLink, Loader2, ShieldAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { AwsIcon, CloudflareIcon } from '~/components/provider-icons'
import { cn } from '~/lib/utils'
import { buildAwsSetupPolicy, validateBucketName, type ProvisionStep } from '~/server/provision/helpers'
import { getDestinations, provisionDestination } from '~/server/fns'

type Provider = 'r2' | 'aws'
type Outcome = Awaited<ReturnType<typeof provisionDestination>>
type NewDestination = Awaited<ReturnType<typeof getDestinations>>['destinations'][number]

const STEPS = ['Provider', 'Credentials', 'Options', 'Create', 'Done'] as const

/** The full expected pipeline per provider, in order — used to render the live/failed progress view
 * with every step visible (pending ones greyed out), not just the steps that happened to run before a
 * failure. Real step ids/labels mirrored from r2.server.ts / aws.server.ts; kept here (not imported)
 * because those files only push steps as they execute, they don't expose the plan up front. */
const STEP_PLAN: Record<Provider, { id: string; label: string }[]> = {
  r2: [
    { id: 'verify', label: 'Verify setup token' },
    { id: 'bucket', label: 'Create bucket' },
    { id: 'lock', label: 'Bucket lock' },
    { id: 'permissions', label: 'Look up R2 bucket permission groups' },
    { id: 'token', label: 'Mint a scoped access token' },
    { id: 'credentials', label: 'Derive S3 credentials' },
    { id: 'test', label: 'Verify the new destination' },
  ],
  aws: [
    { id: 'verify', label: 'Verify setup credentials' },
    { id: 'bucket', label: 'Create bucket' },
    { id: 'public-access-block', label: 'Block public access' },
    { id: 'encryption', label: 'Enable default encryption (SSE-S3)' },
    { id: 'lock', label: 'Object Lock' },
    { id: 'iam-user', label: 'Create IAM user' },
    { id: 'iam-policy', label: 'Attach least-privilege bucket policy' },
    { id: 'access-key', label: 'Create access key' },
    { id: 'test', label: 'Verify the new destination' },
  ],
}

function fmtMs(ms: number | undefined): string {
  if (ms == null) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/**
 * "Create bucket for me": a 5-step wizard that creates a cloud bucket and scoped credentials on the
 * user's behalf (Cloudflare R2 or AWS S3), then saves it as a destination. See the provisioning logic
 * in ~/server/provision/{r2,aws,index}.server.ts. Visual language follows DESIGN.md §4.3/§5.4: a
 * centered dialog, a horizontal 5-chip stepper, and a vertical Pipeline Step list for live/failed/done
 * progress — the same primitive vocabulary as the backup/restore run pipeline.
 */
export function ProvisionWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useServerFn(provisionDestination)
  const fetchDestinations = useServerFn(getDestinations)
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [provider, setProvider] = useState<Provider>('r2')
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [created, setCreated] = useState<NewDestination | null>(null)
  const [showSteps, setShowSteps] = useState(false)

  // R2 fields
  const [r2AccountId, setR2AccountId] = useState('')
  const [r2Token, setR2Token] = useState('')
  const [r2Jurisdiction, setR2Jurisdiction] = useState<'default' | 'eu' | 'fedramp'>('default')
  const [r2LockDays, setR2LockDays] = useState('')

  // AWS fields
  const [awsKeyId, setAwsKeyId] = useState('')
  const [awsSecret, setAwsSecret] = useState('')
  const [awsSessionToken, setAwsSessionToken] = useState('')
  const [awsRegion, setAwsRegion] = useState('us-east-1')
  const [awsLock, setAwsLock] = useState(false)
  const [awsLockMode, setAwsLockMode] = useState<'GOVERNANCE' | 'COMPLIANCE'>('GOVERNANCE')
  const [awsLockDays, setAwsLockDays] = useState('30')

  // Shared options
  const [name, setName] = useState('')
  const [bucket, setBucket] = useState('')
  const [prefix, setPrefix] = useState('')
  const bucketError = bucket ? validateBucketName(provider, bucket) : null

  function reset() {
    setStep(0)
    setOutcome(null)
    setCreated(null)
    setShowSteps(false)
    setRunning(false)
  }

  async function start() {
    setStep(3)
    setRunning(true)
    try {
      const result = await run({
        data:
          provider === 'r2'
            ? {
                provider: 'r2',
                name,
                accountId: r2AccountId,
                setupToken: r2Token,
                bucket,
                jurisdiction: r2Jurisdiction,
                lockDays: r2LockDays ? Number(r2LockDays) : undefined,
                prefix: prefix || undefined,
              }
            : {
                provider: 'aws',
                name,
                accessKeyId: awsKeyId,
                secretAccessKey: awsSecret,
                sessionToken: awsSessionToken || undefined,
                region: awsRegion,
                bucket,
                prefix: prefix || undefined,
                lock: awsLock ? { mode: awsLockMode, days: Number(awsLockDays) } : undefined,
              },
      })
      setOutcome(result)
      if (result.ok) {
        toast.success(`${name} is ready`)
        await router.invalidate()
        const { destinations } = await fetchDestinations()
        setCreated(destinations.find((d) => d.id === result.destinationId) ?? null)
        setStep(4)
      }
      // On failure, stay on the "Create" step — the failure board (§5.4 "failed") renders inline there,
      // matching the design's stepper where "Done" is never reached.
    } catch (err) {
      setOutcome({ ok: false, steps: [], error: err instanceof Error ? err.message : String(err) })
    } finally {
      setRunning(false)
    }
  }

  const credentialsValid = provider === 'r2' ? r2AccountId.trim() && r2Token.trim() : awsKeyId.trim() && awsSecret.trim()
  const optionsValid = name.trim() && bucket.trim() && !bucketError
  const failed = step === 3 && !running && outcome && !outcome.ok

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          reset()
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="items-center text-center">
          <div
            className={cn(
              'mb-1 flex size-11 items-center justify-center rounded-lg border',
              step === 4 ? 'border-success/30 bg-success-muted text-success' : failed ? 'border-danger/30 bg-danger-muted text-danger' : 'bg-muted text-muted-foreground',
            )}
          >
            {step === 4 ? <Check className="size-5" /> : failed ? <X className="size-5" /> : <CloudCog className="size-5" />}
          </div>
          <DialogTitle className="text-base">
            {step === 4 ? 'Your bucket is ready' : failed ? `Could not finish provisioning${provider === 'aws' ? ' on AWS' : ' on Cloudflare R2'}` : 'Create a bucket for me'}
          </DialogTitle>
          <DialogDescription className="max-w-md">
            {step === 4
              ? "The bucket and a bucket-scoped credential were created and verified with a test write."
              : failed
                ? 'Provisioning stopped before it finished. Everything this request created has already been cleaned up.'
                : step === 3
                  ? `Creating the bucket and a bucket-scoped credential on ${provider === 'aws' ? 'AWS' : 'Cloudflare'}. This usually takes under 30 seconds.`
                  : 'Paste a one-time setup credential and the console creates the bucket and a brand-new, bucket-scoped credential for you.'}
          </DialogDescription>
        </DialogHeader>

        <HorizontalStepper current={step} failedAt={failed ? 3 : null} />

        {step === 0 && (
          <FieldGroup className="py-2">
            <FieldLabel className="px-0.5">Choose a provider</FieldLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setProvider('r2')}
                className={cn('relative rounded-lg border p-4 text-left transition-colors', provider === 'r2' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}
              >
                <ProviderCheck selected={provider === 'r2'} />
                <div className="flex items-center gap-2 font-medium">
                  <CloudflareIcon className="size-5" /> Cloudflare R2
                </div>
                <p className="text-muted-foreground mt-1 text-sm">A one-time setup API token + Account ID.</p>
                <p className="text-muted-foreground mt-2 font-mono text-2xs">S3-compatible · no egress fees</p>
              </button>
              <button
                type="button"
                onClick={() => setProvider('aws')}
                className={cn('relative rounded-lg border p-4 text-left transition-colors', provider === 'aws' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}
              >
                <ProviderCheck selected={provider === 'aws'} />
                <div className="flex items-center gap-2 font-medium">
                  <AwsIcon className="size-5" /> AWS S3
                </div>
                <p className="text-muted-foreground mt-1 text-sm">A one-time setup IAM access key.</p>
                <p className="text-muted-foreground mt-2 font-mono text-2xs">Any region · Object Lock</p>
              </button>
            </div>
          </FieldGroup>
        )}

        {step === 1 && provider === 'r2' && (
          <FieldGroup className="py-2">
            <Field>
              <FieldLabel htmlFor="r2-account">Account ID</FieldLabel>
              <Input id="r2-account" value={r2AccountId} onChange={(e) => setR2AccountId(e.target.value)} autoComplete="off" />
            </Field>
            <Field>
              <FieldLabel htmlFor="r2-token">Setup API token</FieldLabel>
              <Input id="r2-token" type="password" value={r2Token} onChange={(e) => setR2Token(e.target.value)} autoComplete="off" />
              <FieldDescription>
                Create one at the{' '}
                <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5">
                  Cloudflare API Tokens page <ExternalLink className="size-3" />
                </a>{' '}
                with exactly: <code>Workers R2 Storage: Edit</code> and <code>Account API Tokens: Edit</code>.
              </FieldDescription>
            </Field>
            <Alert>
              <AlertTitle>This token is used once</AlertTitle>
              <AlertDescription>It's held in memory for this request only — never stored, logged, or shown again. You can revoke it as soon as the bucket is created.</AlertDescription>
            </Alert>
          </FieldGroup>
        )}

        {step === 1 && provider === 'aws' && (
          <FieldGroup className="py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="aws-key">Setup access key ID</FieldLabel>
                <Input id="aws-key" value={awsKeyId} onChange={(e) => setAwsKeyId(e.target.value)} autoComplete="off" />
              </Field>
              <Field>
                <FieldLabel htmlFor="aws-secret">Setup secret access key</FieldLabel>
                <Input id="aws-secret" type="password" value={awsSecret} onChange={(e) => setAwsSecret(e.target.value)} autoComplete="off" />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="aws-session">Session token (optional)</FieldLabel>
              <Input id="aws-session" value={awsSessionToken} onChange={(e) => setAwsSessionToken(e.target.value)} autoComplete="off" />
              <FieldDescription>Only needed for temporary STS credentials.</FieldDescription>
            </Field>
            <Field>
              <FieldContent>
                <FieldLabel>Minimal setup IAM policy</FieldLabel>
                <FieldDescription>
                  Create a one-time IAM user in the{' '}
                  <a href="https://console.aws.amazon.com/iam/home#/users" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5">
                    IAM console <ExternalLink className="size-3" />
                  </a>{' '}
                  with this inline policy, generate an access key for it, then paste the key above.
                </FieldDescription>
              </FieldContent>
            </Field>
            <CopyablePolicy policy={buildAwsSetupPolicy()} />
            <Alert>
              <AlertTitle>This key is used once</AlertTitle>
              <AlertDescription>It's held in memory for this request only — never stored, logged, or shown again. You can delete it as soon as the bucket is created.</AlertDescription>
            </Alert>
          </FieldGroup>
        )}

        {step === 2 && (
          <FieldGroup className="py-2">
            <Field>
              <FieldLabel htmlFor="p-name">Destination name</FieldLabel>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={provider === 'r2' ? 'r2-eu' : 'aws-s3'} />
            </Field>
            <Field>
              <FieldLabel htmlFor="p-bucket">Bucket name</FieldLabel>
              <Input id="p-bucket" value={bucket} onChange={(e) => setBucket(e.target.value.toLowerCase())} placeholder="convex-backups-2026" />
              {bucketError && <FieldDescription className="text-destructive">{bucketError}</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="p-prefix">Folder prefix (optional)</FieldLabel>
              <Input id="p-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="convex" />
            </Field>

            {provider === 'r2' ? (
              <>
                <Field>
                  <FieldLabel>Jurisdiction</FieldLabel>
                  <Select value={r2Jurisdiction} onValueChange={(v) => setR2Jurisdiction(v as typeof r2Jurisdiction)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default (global)</SelectItem>
                      <SelectItem value="eu">EU</SelectItem>
                      <SelectItem value="fedramp">FedRAMP</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="r2-lock">Bucket lock, days (optional)</FieldLabel>
                  <Input id="r2-lock" type="number" min={1} max={3650} value={r2LockDays} onChange={(e) => setR2LockDays(e.target.value)} placeholder="e.g. 30" />
                  <FieldDescription>Cloudflare's own bucket-level lock, not S3 Object Lock.</FieldDescription>
                </Field>
              </>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="aws-region">Region</FieldLabel>
                  <Input id="aws-region" value={awsRegion} onChange={(e) => setAwsRegion(e.target.value)} placeholder="us-east-1" />
                </Field>
                <Field orientation="horizontal" className="rounded-md border p-3">
                  <Checkbox id="aws-lock" checked={awsLock} onCheckedChange={(v) => setAwsLock(v === true)} />
                  <FieldContent>
                    <FieldLabel htmlFor="aws-lock" className="font-normal">Enable S3 Object Lock</FieldLabel>
                    <FieldDescription>Only possible when the bucket is newly created, not on a bucket that already exists.</FieldDescription>
                  </FieldContent>
                </Field>
                {awsLock && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>Mode</FieldLabel>
                      <Select value={awsLockMode} onValueChange={(v) => setAwsLockMode(v as typeof awsLockMode)}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GOVERNANCE">Governance</SelectItem>
                          <SelectItem value="COMPLIANCE">Compliance</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="aws-lock-days">Lock for (days)</FieldLabel>
                      <Input id="aws-lock-days" type="number" min={1} max={3650} value={awsLockDays} onChange={(e) => setAwsLockDays(e.target.value)} />
                    </Field>
                  </div>
                )}
              </>
            )}
          </FieldGroup>
        )}

        {step === 3 && (
          <ProgressView
            provider={provider}
            region={provider === 'aws' ? awsRegion : undefined}
            running={running}
            outcome={outcome}
          />
        )}

        {step === 4 && outcome?.ok && (
          <DoneView
            outcome={outcome}
            provider={provider}
            created={created}
            showSteps={showSteps}
            onToggleSteps={() => setShowSteps((s) => !s)}
            onClose={() => { onClose(); reset() }}
          />
        )}

        {step < 4 && !failed && (
          <DialogFooter>
            {step > 0 && step < 3 && (
              <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft /> Back
              </Button>
            )}
            {step === 0 && (
              <>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <a
                  href="/destinations?action=add"
                  onClick={(e) => { e.preventDefault(); onClose(); reset() }}
                  className="text-muted-foreground mr-auto text-xs underline-offset-2 hover:underline"
                >
                  I'll connect an existing bucket instead
                </a>
              </>
            )}
            {step < 2 && (
              <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={step === 1 && !credentialsValid}>
                Continue <ArrowRight />
              </Button>
            )}
            {step === 2 && (
              <Button type="button" onClick={start} disabled={!optionsValid}>
                Create bucket <ArrowRight />
              </Button>
            )}
            {step === 3 && running && (
              <Button type="button" variant="outline" disabled>
                <Loader2 className="animate-spin" /> Working…
              </Button>
            )}
          </DialogFooter>
        )}

        {failed && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft /> Back
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Horizontal 5-chip stepper (DESIGN.md §4.3): a numbered circle + label per step, joined by a thin
 * connector. Current = filled primary, done = success check, failed = danger x, pending = outline. */
function HorizontalStepper({ current, failedAt }: { current: number; failedAt: number | null }) {
  return (
    <div className="flex items-center justify-center gap-1 py-2">
      {STEPS.map((label, i) => {
        const isFailed = failedAt === i
        const isDone = !isFailed && i < current
        const isCurrent = !isFailed && i === current
        return (
          <div key={label} className="flex items-center">
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
                isFailed && 'bg-danger-muted font-medium text-danger',
                isDone && 'bg-success-muted text-success',
                isCurrent && 'bg-primary text-primary-foreground font-medium',
                !isFailed && !isDone && !isCurrent && 'border border-border text-muted-foreground',
              )}
            >
              {isFailed ? <X className="size-3" /> : isDone ? <Check className="size-3" /> : <span className="block size-1.5 rounded-full bg-current" />}
              {label}
            </div>
            {i < STEPS.length - 1 && <div aria-hidden className="bg-border mx-1 h-px w-5" />}
          </div>
        )
      })}
    </div>
  )
}

function ProviderCheck({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute top-3 right-3 flex size-4 items-center justify-center rounded-full border',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
      )}
    >
      {selected && <Check className="size-2.5" />}
    </span>
  )
}

function CopyablePolicy({ policy }: { policy: unknown }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(policy, null, 2)
  return (
    <div className="relative">
      <pre className="bg-muted max-h-48 overflow-auto rounded-md border p-3 font-mono text-xs">{json}</pre>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="absolute top-2 right-2"
        onClick={() => {
          void navigator.clipboard.writeText(json)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/** The merged view driving the vertical pipeline (DESIGN.md §5.4): every planned step is always
 * visible (pending ones greyed, matching the design's "full plan up front" progress board), filled in
 * with the real status/detail/duration as `outcome.steps` arrive. On failure, steps the backend never
 * reached are shown as "skipped" and any `rollback-*` entries split out into their own amber section. */
function ProgressView({
  provider,
  region,
  running,
  outcome,
}: {
  provider: Provider
  region?: string
  running: boolean
  outcome: Outcome | null
}) {
  type Row = { id: string; label: string; status: ProvisionStep['status'] | 'pending'; detail?: string; ms?: number }
  const plan = STEP_PLAN[provider]
  const byId = new Map((outcome?.steps ?? []).filter((s) => !s.id.startsWith('rollback-')).map((s) => [s.id, s]))
  const rollbackSteps = (outcome?.steps ?? []).filter((s) => s.id.startsWith('rollback-'))
  const failed = outcome !== null && !outcome.ok

  let doneCount = 0
  const rows: Row[] = plan.map((p) => {
    const actual = byId.get(p.id)
    if (actual) {
      if (actual.status === 'ok' || actual.status === 'rolled_back') doneCount++
      return actual
    }
    // Not reached yet: "skipped" once the run has already failed (the backend never got here and
    // everything it would have created was rolled back) — otherwise still pending.
    return { id: p.id, label: p.label, status: failed ? 'skipped' : 'pending' }
  })
  const activeIndex = running ? rows.findIndex((r) => r.status === 'pending') : -1

  return (
    <div className="py-2">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <CloudCog className="size-3.5" />
          Provisioning on {provider === 'aws' ? 'AWS' : 'Cloudflare R2'} {region && <span className="font-mono">{region}</span>}
        </span>
        <span className={cn('font-mono', failed ? 'text-danger' : 'text-muted-foreground')}>
          {failed ? 'stopped' : running ? 'running' : 'done'} · {doneCount} of {plan.length} done
        </span>
      </div>
      <ol className="flex flex-col overflow-hidden rounded-lg border">
        {rows.map((s, i) => {
          const active = i === activeIndex
          return (
            <li
              key={s.id}
              className={cn(
                'flex items-center justify-between gap-3 border-b px-3 py-2.5 text-sm last:border-b-0',
                (s.status === 'ok' || s.status === 'rolled_back') && 'bg-success-muted',
                s.status === 'failed' && 'bg-danger-muted',
                active && 'bg-running-muted',
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <StepIcon status={s.status} active={active} />
                <div className="min-w-0">
                  <div className={cn('truncate', (s.status === 'pending' || s.status === 'skipped') && 'text-muted-foreground', (active || s.status === 'failed') && 'font-medium')}>
                    {s.label}
                  </div>
                  {s.detail && <div className="text-muted-foreground truncate font-mono text-xs">{s.detail}</div>}
                </div>
              </div>
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {active ? 'running' : s.status === 'skipped' ? 'skipped' : s.status === 'failed' ? 'failed' : s.status === 'pending' ? '' : fmtMs(s.ms)}
              </span>
            </li>
          )
        })}
      </ol>

      {rollbackSteps.length > 0 && (
        <div className="mt-3">
          <div className="text-muted-foreground mb-1.5 flex items-center gap-1 text-xs">
            <ShieldAlert className="size-3.5" /> Cleanup after failure
          </div>
          <ol className="flex flex-col overflow-hidden rounded-lg border border-warning/30">
            {rollbackSteps.map((s) => (
              <li key={s.id} className="bg-warning-muted flex items-center justify-between gap-3 border-b border-warning/20 px-3 py-2.5 text-sm last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.label}</div>
                  {s.detail && <div className="text-muted-foreground truncate font-mono text-xs">{s.detail}</div>}
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 font-mono text-2xs', s.status === 'rolled_back' ? 'bg-warning text-warning-foreground' : 'bg-danger text-danger-foreground')}>
                  {s.status === 'rolled_back' ? 'rolled back' : 'failed'}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {failed && outcome && !outcome.ok ? (
        <Alert variant="destructive" className="mt-3">
          <X className="size-4" />
          <AlertTitle>Could not finish provisioning{provider === 'aws' ? ' on AWS' : ' on Cloudflare R2'}</AlertTitle>
          <AlertDescription>
            {outcome.error}
            <br />
            The bucket this request created has already been cleaned up, so nothing was left behind on your account. Fix the setup credential's permissions, or go back and paste a different one.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
          <ShieldAlert className="size-3.5" />
          Keep this dialog open. If any step fails, everything this request created is rolled back automatically.
        </p>
      )}
    </div>
  )
}

function StepIcon({ status, active }: { status: ProvisionStep['status'] | 'pending'; active: boolean }) {
  if (active) return <Loader2 className="text-running size-4 shrink-0 animate-spin" />
  if (status === 'ok' || status === 'rolled_back') return <Check className="text-success size-4 shrink-0" />
  if (status === 'failed') return <X className="text-danger size-4 shrink-0" />
  return <span aria-hidden className="block size-2 shrink-0 rounded-full border border-muted-foreground/40" />
}

function DoneView({
  outcome,
  provider,
  created,
  showSteps,
  onToggleSteps,
  onClose,
}: {
  outcome: Extract<Outcome, { ok: true }>
  provider: Provider
  created: NewDestination | null
  showSteps: boolean
  onToggleSteps: () => void
  onClose: () => void
}) {
  const totalMs = outcome.steps.reduce((sum, s) => sum + (s.ms ?? 0), 0)
  const mark = provider === 'aws' ? AwsIcon : CloudflareIcon
  const Mark = mark
  const jobHref = created ? `/jobs?action=new&destination=${created.id}` : '/jobs?action=new'

  return (
    <div className="flex flex-col gap-3 py-2">
      <button
        type="button"
        onClick={onToggleSteps}
        className="bg-success-muted text-success-foreground flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Check className="size-3.5" /> All {outcome.steps.length} steps completed in {fmtMs(totalMs)}
        </span>
        <span className="inline-flex items-center gap-1 text-xs opacity-80">
          {showSteps ? 'Hide steps' : 'Show steps'} <ChevronDown className={cn('size-3.5 transition-transform', showSteps && 'rotate-180')} />
        </span>
      </button>

      {showSteps && (
        <ol className="flex flex-col overflow-hidden rounded-lg border">
          {outcome.steps
            .filter((s) => !s.id.startsWith('rollback-'))
            .map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0">
                <div className="flex min-w-0 items-center gap-2">
                  <StepIcon status={s.status} active={false} />
                  <span className="truncate">{s.label}</span>
                </div>
                <span className="text-muted-foreground shrink-0 font-mono text-xs">{fmtMs(s.ms)}</span>
              </li>
            ))}
        </ol>
      )}

      {created && (
        <div className="overflow-hidden rounded-lg border">
          <div className="bg-muted flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
            <span className="flex items-center gap-1.5"><Mark /> New destination · {created.provider === 'aws' ? 'AWS S3' : created.provider === 'r2' ? 'Cloudflare R2' : 'S3-compatible'}</span>
            <span className="text-success flex items-center gap-1 text-xs font-medium">
              <span className="bg-success block size-1.5 rounded-full" /> Verified
            </span>
          </div>
          <div className="divide-y">
            {created.bucket && (
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Bucket</span>
                <span className="font-mono">{created.bucket}</span>
              </div>
            )}
            {created.region && (
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Region</span>
                <span className="font-mono">{created.region}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-muted-foreground">Estimated storage cost</span>
              <span className="font-mono">~${created.price}/GB-month</span>
            </div>
          </div>
        </div>
      )}

      <Alert className="border-warning/30 bg-warning-muted">
        <ShieldAlert className="text-warning size-4" />
        <AlertTitle>Revoke your setup credential now</AlertTitle>
        <AlertDescription>{outcome.revokeNote}</AlertDescription>
      </Alert>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Done</Button>
        <Button type="button" asChild>
          <a href={jobHref} onClick={() => onClose()}>
            Create your first job with this destination <ArrowRight />
          </a>
        </Button>
      </DialogFooter>
    </div>
  )
}

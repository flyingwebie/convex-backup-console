import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Activity, Cloud, Copy, HardDrive, Download, Eye, EyeOff, ImageUp, KeyRound, Mail, Plus, RefreshCw, Send, ShieldAlert, Trash2, TriangleAlert, Webhook, X } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { timeAgo } from '~/lib/format'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageBody, PageHeader } from '~/components/page'
import { WorkspaceLogo } from '~/components/workspace-logo'
import { slugify } from '~/components/create-workspace'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { useAction } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { purgeSummary } from '~/lib/format'
import {
  setApiEnabled,
  createEncryption,
  deleteWorkspace,
  getWorkspace,
  revealEncryptionKey,
  createApiToken,
  getApiTokens,
  getScrubRules,
  revokeApiToken,
  saveScrubRules,
  rotateStatusToken,
  sendTestDigest,
  updateDigest,
  updateDeletionPolicy,
  updateWorkspaceDefaults,
  updateWorkspaceGeneral,
} from '~/server/fns'

export const Route = createFileRoute('/_app/workspace')({
  loader: async () => {
    const ws = await getWorkspace()
    const canSettings = ['owner', 'admin'].includes(ws.workspace.role)
    return { ...ws, scrub: await getScrubRules(), api: canSettings ? await getApiTokens() : null }
  },
  component: WorkspaceSettings,
})

type Data = Awaited<ReturnType<typeof getWorkspace>> & {
  scrub: Awaited<ReturnType<typeof getScrubRules>>
  api: Awaited<ReturnType<typeof getApiTokens>> | null
}

function WorkspaceSettings() {
  const data = Route.useLoaderData()
  const { can } = useWorkspace()
  return (
    <>
      <PageHeader title="Workspace settings" description={`Identity, defaults and policies for ${data.workspace.name}.`} />
      <PageBody>
        <GeneralCard data={data} editable={can('settings')} />
        <DefaultsCard data={data} editable={can('settings')} />
        <MonitoringCard data={data} editable={can('settings')} />
        {data.api && <ApiTokensCard api={data.api} />}
        <ScrubCard rules={data.scrub.rules} editable={can('settings')} />
        <DeletionCard data={data} editable={can('purge')} />
        <EncryptionCard data={data} owner={can('encryptionKey')} />
        {can('deleteWorkspace') && <DangerCard data={data} />}
      </PageBody>
    </>
  )
}

function LogoPicker({ data, editable }: { data: Data; editable: boolean }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  async function upload(file: File | null) {
    setBusy(true)
    const res = file
      ? await fetch('/api/logo', { method: 'POST', body: (() => { const f = new FormData(); f.set('file', file); return f })() })
      : await fetch('/api/logo', { method: 'DELETE' })
    setBusy(false)
    const body = (await res.json()) as { error?: string }
    if (!res.ok) return toast.error(body.error ?? 'Upload failed')
    toast.success(file ? 'Logo updated' : 'Logo removed')
    await router.invalidate()
  }
  return (
    <div className="flex items-center gap-4">
      <WorkspaceLogo name={data.workspace.name} logo={data.workspace.logo} className="size-16 rounded-xl text-lg" />
      {editable && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              <ImageUp /> {data.workspace.logo ? 'Replace logo' : 'Upload logo'}
            </Button>
            {data.workspace.logo && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => upload(null)}>
                <X /> Remove
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">PNG, JPG, SVG or WebP, up to 512 KB. Square works best.</p>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void upload(f)
            }}
          />
        </div>
      )}
    </div>
  )
}

function GeneralCard({ data, editable }: { data: Data; editable: boolean }) {
  const save = useServerFn(updateWorkspaceGeneral)
  const { run, pending } = useAction()
  const [name, setName] = useState(data.workspace.name)
  const [slug, setSlug] = useState(data.workspace.slug)
  const [description, setDescription] = useState(data.settings.description ?? '')
  const [timezone, setTimezone] = useState(data.settings.timezone)
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => save({ data: { name, slug, description, timezone } }), { success: 'Workspace saved' })
        }}
      >
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Shown in the sidebar, invitations and alert messages.</CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup>
            <LogoPicker data={data} editable={editable} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ws-name">Name</FieldLabel>
                <Input id="ws-name" value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="ws-slug">Slug</FieldLabel>
                <Input id="ws-slug" value={slug} disabled={!editable} onChange={(e) => setSlug(slugify(e.target.value))} required />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="ws-desc">Description</FieldLabel>
              <Textarea id="ws-desc" value={description} disabled={!editable} onChange={(e) => setDescription(e.target.value)} placeholder="Client, contract or notes for your team" maxLength={280} />
            </Field>
            <Field>
              <FieldLabel>Timezone</FieldLabel>
              <Select value={timezone} onValueChange={setTimezone} disabled={!editable}>
                <SelectTrigger className="w-full sm:w-80"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-80">
                  {data.timezones.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldDescription>Schedules run in this timezone ("Daily at 03:00" means 03:00 here).</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        {editable && <CardFooter><Button type="submit" disabled={pending}>Save</Button></CardFooter>}
      </form>
    </Card>
  )
}

function DefaultsCard({ data, editable }: { data: Data; editable: boolean }) {
  const save = useServerFn(updateWorkspaceDefaults)
  const { run, pending } = useAction()
  const s = data.settings
  const str = (v: number | null) => (v ? String(v) : '')
  const [keep, setKeep] = useState({ keepLast: str(s.default_keep_last), keepDaily: str(s.default_keep_daily), keepWeekly: str(s.default_keep_weekly), keepMonthly: str(s.default_keep_monthly) })
  const [encrypt, setEncrypt] = useState(s.default_encrypt)
  const [includeStorage, setIncludeStorage] = useState(s.default_include_storage)
  const [staleHours, setStaleHours] = useState(String(s.stale_hours))
  const num = (v: string) => (v ? Number(v) : null)
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(
            () =>
              save({
                data: {
                  keepLast: num(keep.keepLast),
                  keepDaily: num(keep.keepDaily),
                  keepWeekly: num(keep.keepWeekly),
                  keepMonthly: num(keep.keepMonthly),
                  encrypt,
                  includeStorage,
                  staleHours: Number(staleHours),
                },
              }),
            { success: 'Defaults saved' },
          )
        }}
      >
        <CardHeader>
          <CardTitle>Defaults & monitoring</CardTitle>
          <CardDescription>Pre-filled when creating a job. Existing jobs are not changed.</CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['keepLast', 'Keep latest'],
                  ['keepDaily', 'Daily'],
                  ['keepWeekly', 'Weekly'],
                  ['keepMonthly', 'Monthly'],
                ] as const
              ).map(([k, label]) => (
                <Field key={k}>
                  <FieldLabel htmlFor={`d-${k}`}>{label}</FieldLabel>
                  <Input id={`d-${k}`} type="number" min={1} value={keep[k]} disabled={!editable} onChange={(e) => setKeep((v) => ({ ...v, [k]: e.target.value }))} placeholder="—" />
                </Field>
              ))}
            </div>
            <Field orientation="horizontal" className="rounded-md border p-3">
              <FieldContent>
                <FieldLabel htmlFor="d-encrypt">Encrypt new jobs</FieldLabel>
                <FieldDescription>Requires the workspace encryption key below.</FieldDescription>
              </FieldContent>
              <Switch id="d-encrypt" checked={encrypt} disabled={!editable} onCheckedChange={setEncrypt} />
            </Field>
            <Field orientation="horizontal" className="rounded-md border p-3">
              <FieldContent>
                <FieldLabel htmlFor="d-storage">Include file storage in new jobs</FieldLabel>
              </FieldContent>
              <Switch id="d-storage" checked={includeStorage} disabled={!editable} onCheckedChange={setIncludeStorage} />
            </Field>
            <Field>
              <FieldLabel htmlFor="d-stale">Warn when an instance has no good backup for (hours)</FieldLabel>
              <Input id="d-stale" type="number" min={1} max={744} className="w-32" value={staleHours} disabled={!editable} onChange={(e) => setStaleHours(e.target.value)} />
              <FieldDescription>Shown on the Overview. 26 suits nightly jobs.</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        {editable && <CardFooter><Button type="submit" disabled={pending}>Save defaults</Button></CardFooter>}
      </form>
    </Card>
  )
}

function DeletionCard({ data, editable }: { data: Data; editable: boolean }) {
  const save = useServerFn(updateDeletionPolicy)
  const { run, pending } = useAction()
  const [trashDays, setTrashDays] = useState(String(data.settings.trash_days))
  const [purgeRemote, setPurgeRemote] = useState(data.settings.purge_remote)
  const [purgeLocal, setPurgeLocal] = useState(data.settings.purge_local)
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => save({ data: { trashDays: Number(trashDays), purgeRemote, purgeLocal } }), { success: 'Deletion policy saved' })
        }}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trash2 className="size-4" /> Deletion policy</CardTitle>
          <CardDescription>What happens when an instance, job, destination or this workspace is deleted. Only owners can change it.</CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="trash-days">Keep deleted items in the Trash for (days)</FieldLabel>
              <Input id="trash-days" type="number" min={0} max={365} className="w-32" value={trashDays} disabled={!editable} onChange={(e) => setTrashDays(e.target.value)} />
              <FieldDescription>They can be restored during this time. 0 deletes immediately.</FieldDescription>
            </Field>
            <div className="space-y-1">
              <div className="text-sm font-medium">Delete their backup files when purged</div>
              <p className="text-muted-foreground text-sm">
                Off (recommended): backups stay after the instance or job is gone, so you can still recover. On: they're deleted when the grace period
                ends. Files under Object Lock are skipped until their lock expires; files in a deleted destination are never touched.
              </p>
            </div>
            <Field orientation="horizontal" className="rounded-md border p-3">
              <FieldContent>
                <FieldLabel htmlFor="purge-remote" className="flex items-center gap-2"><Cloud className="size-4" /> Remote storage</FieldLabel>
                <FieldDescription>S3-compatible destinations: Cloudflare R2, AWS S3, Backblaze B2, MinIO…</FieldDescription>
              </FieldContent>
              <Switch id="purge-remote" checked={purgeRemote} disabled={!editable} onCheckedChange={setPurgeRemote} />
            </Field>
            <Field orientation="horizontal" className="rounded-md border p-3">
              <FieldContent>
                <FieldLabel htmlFor="purge-local" className="flex items-center gap-2"><HardDrive className="size-4" /> Local storage</FieldLabel>
                <FieldDescription>Local-volume destinations on the console's server.</FieldDescription>
              </FieldContent>
              <Switch id="purge-local" checked={purgeLocal} disabled={!editable} onCheckedChange={setPurgeLocal} />
            </Field>
            {(purgeRemote || purgeLocal) && Number(trashDays) === 0 && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>No safety net</AlertTitle>
                <AlertDescription>
                  Deleting an instance will immediately and permanently delete its backups from {purgeRemote && purgeLocal ? 'all' : purgeRemote ? 'remote' : 'local'} storage.
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </CardContent>
        {editable && <CardFooter><Button type="submit" disabled={pending}>Save policy</Button></CardFooter>}
      </form>
    </Card>
  )
}

function KeyBox({ identity, recipient }: { identity: string; recipient: string }) {
  const file = `# Convex Backup Console age key\n# public key: ${recipient}\n${identity}\n`
  return (
    <div className="space-y-3">
      <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">{identity}</pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(identity).then(() => toast.success('Private key copied'))}>
          <Copy /> Copy
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(file)}`} download="convex-backups-age-key.txt"><Download /> Download key file</a>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Recover without the console: <code>age -d -i convex-backups-age-key.txt backup.zip.age &gt; backup.zip</code>
      </p>
    </div>
  )
}

function EncryptionCard({ data, owner }: { data: Data; owner: boolean }) {
  const create = useServerFn(createEncryption)
  const reveal = useServerFn(revealEncryptionKey)
  const { run, pending } = useAction()
  const [shown, setShown] = useState<{ identity: string; recipient: string } | null>(null)
  const recipient = data.settings.recipient
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Encryption key</CardTitle>
        <CardDescription>
          This workspace's backups are encrypted with its own <a className="underline" href="https://age-encryption.org" target="_blank" rel="noreferrer">age</a> key
          before leaving the server, so a leaked bucket doesn't leak data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recipient ? (
          <>
            <Field>
              <FieldLabel>Public key (recipient)</FieldLabel>
              <code className="bg-muted block overflow-x-auto rounded-md p-2 text-xs">{recipient}</code>
            </Field>
            <Alert>
              <TriangleAlert />
              <AlertTitle>Keep a copy of the private key outside this server</AlertTitle>
              <AlertDescription>If you lose both the server and the key, encrypted backups can't be recovered.</AlertDescription>
            </Alert>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">No key yet. Backups are stored as plain zip files.{!owner && ' Ask an owner to create one.'}</p>
        )}
      </CardContent>
      {owner && (
        <CardFooter>
          {recipient ? (
            <Button variant="outline" disabled={pending} onClick={async () => { const r = await run(() => reveal()); if (r) setShown(r) }}>
              <Eye /> Reveal private key
            </Button>
          ) : (
            <Button disabled={pending} onClick={async () => { const r = await run(() => create(), { success: 'Encryption key created' }); if (r) setShown(r) }}>
              <KeyRound /> Create encryption key
            </Button>
          )}
        </CardFooter>
      )}
      <Dialog open={shown !== null} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Save your private key</DialogTitle>
            <DialogDescription>Store it in your password manager now. It's the only way to decrypt backups without this console.</DialogDescription>
          </DialogHeader>
          {shown && <KeyBox identity={shown.identity} recipient={shown.recipient} />}
          <DialogFooter><Button onClick={() => setShown(null)}>I've saved it</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function DangerCard({ data }: { data: Data }) {
  const del = useServerFn(deleteWorkspace)
  const { run, pending } = useAction()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const days = data.settings.trash_days
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive flex items-center gap-2"><ShieldAlert className="size-4" /> Danger zone</CardTitle>
        <CardDescription>
          Deleting the workspace stops all its schedules and hides it from every member.{' '}
          {days > 0 ? `A platform admin can restore it for ${days} day${days === 1 ? '' : 's'}; then it's purged.` : 'It is purged immediately.'}{' '}
          {purgeSummary(data.settings.purge_remote, data.settings.purge_local, 'Its')}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button variant="destructive" onClick={() => setOpen(true)}><Trash2 /> Delete workspace</Button>
      </CardFooter>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const ok = await run(() => del({ data: { confirm } }).then(() => true), { success: 'Workspace deleted' })
              if (ok) window.location.href = '/'
            }}
          >
            <DialogHeader>
              <DialogTitle>Delete {data.workspace.name}?</DialogTitle>
              <DialogDescription>Type the workspace name to confirm.</DialogDescription>
            </DialogHeader>
            <Input className="my-6" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={data.workspace.name} autoComplete="off" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={pending || confirm !== data.workspace.name}>Delete workspace</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function MonitoringCard({ data, editable }: { data: Data; editable: boolean }) {
  const rotate = useServerFn(rotateStatusToken)
  const saveDigest = useServerFn(updateDigest)
  const testDigest = useServerFn(sendTestDigest)
  const { run, pending } = useAction()
  const s = data.settings
  const [digest, setDigest] = useState(s.digest)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="size-4" /> Monitoring & digests</CardTitle>
        <CardDescription>Let an uptime monitor watch backup health, and get a regular summary by email.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 py-2">
        <FieldGroup>
          <Field>
            <FieldLabel>Status URL for uptime monitors</FieldLabel>
            {s.status_url ? (
              <div className="flex gap-2">
                <Input readOnly value={s.status_url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="outline" size="icon" aria-label="Copy" onClick={() => navigator.clipboard.writeText(s.status_url!).then(() => toast.success('Status URL copied'))}>
                  <Copy />
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Disabled.</p>
            )}
            <FieldDescription>
              Returns <code>200</code> when every instance had a good backup within {s.stale_hours} h, otherwise <code>503</code> with details (JSON).
              Works with Uptime Kuma, Better Stack, UptimeRobot… Anyone with the URL can see instance names and backup times.
            </FieldDescription>
            {editable && (
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => rotate({ data: { enabled: true } }), { success: s.status_url ? 'New status URL generated' : 'Status URL enabled' })}>
                  <RefreshCw /> {s.status_url ? 'Regenerate' : 'Enable'}
                </Button>
                {s.status_url && (
                  <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run(() => rotate({ data: { enabled: false } }), { success: 'Status URL disabled' })}>
                    Disable
                  </Button>
                )}
              </div>
            )}
          </Field>
        </FieldGroup>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => saveDigest({ data: { digest } }), { success: 'Digest settings saved' })
          }}
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <Field>
                <FieldLabel>Email digest</FieldLabel>
                <Select value={digest} onValueChange={(v) => setDigest(v as typeof digest)} disabled={!editable}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="daily">Daily at 08:00</SelectItem>
                    <SelectItem value="weekly">Weekly, Monday 08:00</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Recipients</FieldLabel>
                <p className="text-sm">
                  {s.digest_recipients ? `${s.digest_recipients} recipient${s.digest_recipients === 1 ? '' : 's'}` : 'Nobody yet'} ·{' '}
                  <Link to="/emails" search={{ tab: 'recipients' }} className="underline underline-offset-4">Choose on the Emails page</Link>
                </p>
              </Field>
            </div>
            <FieldDescription>
              Runs, failures, restores and the health of every instance, in {s.timezone} time.{' '}
              {!s.smtp && <span className="text-amber-600">Email isn't configured yet — a platform admin (or a workspace owner on the Emails page) can set up SMTP.</span>}
            </FieldDescription>
            {editable && (
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}><Mail /> Save digest</Button>
                <Button type="button" variant="outline" disabled={pending || !s.smtp || !s.digest_recipients} onClick={() => run(() => testDigest(), { success: 'Test digest sent' })}>
                  <Send /> Send test now
                </Button>
              </div>
            )}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

type Rule = { table: string; field: string; method: 'email' | 'name' | 'phone' | 'redact' | 'null' | 'hash' }
const METHODS: Record<Rule['method'], string> = {
  email: 'Fake email (user-a1b2…@example.com)',
  name: 'Fake name (Person 3f9a1c)',
  phone: 'Fake phone (+1555…)',
  redact: 'Replace with "[redacted]"',
  hash: 'Hash (stable, irreversible)',
  null: 'Set to null',
}
const PRESET: Rule[] = [
  { table: '*', field: 'email', method: 'email' },
  { table: '*', field: 'name', method: 'name' },
  { table: '*', field: 'firstName', method: 'name' },
  { table: '*', field: 'lastName', method: 'name' },
  { table: '*', field: 'phone', method: 'phone' },
  { table: '*', field: 'address', method: 'redact' },
]

function ScrubCard({ rules: initial, editable }: { rules: Rule[]; editable: boolean }) {
  const save = useServerFn(saveScrubRules)
  const { run, pending } = useAction()
  const [rules, setRules] = useState<Rule[]>(initial)
  const set = (i: number, patch: Partial<Rule>) => setRules((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><EyeOff className="size-4" /> Data scrubbing</CardTitle>
        <CardDescription>
          Rules applied when a restore has "Scrub personal data" on — for safe staging and dev copies of production. Fields use dot paths
          (<code>profile.phone</code>); table <code>*</code> means every table. Values keep consistent within one restore, so relations still line up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 && <p className="text-muted-foreground text-sm">No rules yet.</p>}
        {rules.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-center gap-2">
            <Input value={r.table} disabled={!editable} onChange={(e) => set(i, { table: e.target.value })} placeholder="table or *" className="font-mono text-xs" aria-label="Table" />
            <Input value={r.field} disabled={!editable} onChange={(e) => set(i, { field: e.target.value })} placeholder="field.path" className="font-mono text-xs" aria-label="Field" />
            <Select value={r.method} disabled={!editable} onValueChange={(v) => set(i, { method: v as Rule['method'] })}>
              <SelectTrigger className="w-full" aria-label="Method"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            {editable && <Button size="icon" variant="ghost" aria-label="Remove rule" onClick={() => setRules((x) => x.filter((_, j) => j !== i))}><X /></Button>}
          </div>
        ))}
        <p className="text-muted-foreground text-xs">"Set to null" fails if your schema requires that field — prefer fake values or "[redacted]".</p>
      </CardContent>
      {editable && (
        <CardFooter className="gap-2">
          <Button onClick={() => run(() => save({ data: { rules: rules.filter((r) => r.table && r.field) } }), { success: 'Scrubbing rules saved' })} disabled={pending}>Save rules</Button>
          <Button variant="outline" onClick={() => setRules((r) => [...r, { table: '*', field: '', method: 'redact' }])}><Plus /> Add rule</Button>
          <Button
            variant="ghost"
            onClick={() => setRules((r) => [...r, ...PRESET.filter((p) => !r.some((x) => x.table === p.table && x.field === p.field))])}
          >
            Add common personal fields
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

function ApiTokensCard({ api }: { api: NonNullable<Data['api']> }) {
  const revoke = useServerFn(revokeApiToken)
  const toggle = useServerFn(setApiEnabled)
  const { run, pending } = useAction()
  const [open, setOpen] = useState(false)
  const firstJob = api.jobs[0]?.id ?? '<job-id>'
  const snippet = `- name: Back up before deploying
  uses: flyingwebie/convex-backup-console/.github/actions/convex-backup@main
  with:
    console-url: ${api.baseUrl}
    token: \${{ secrets.BACKUP_CONSOLE_TOKEN }}
    job-id: ${firstJob}`
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Webhook className="size-4" /> API tokens</CardTitle>
        <CardDescription>
          For CI/CD — e.g. back up right before <code>npx convex deploy</code> with the GitHub Action. Tokens act only on this workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field orientation="horizontal" className="rounded-md border p-3">
          <FieldContent>
            <FieldLabel htmlFor="api-enabled">Allow API access & GitHub Action</FieldLabel>
            <FieldDescription>
              {api.enabled
                ? 'Tokens below can trigger backups and read status.'
                : 'Off: every API call is refused, and the GitHub Action skips the backup with a warning (your deploy still runs). Tokens are kept.'}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="api-enabled"
            checked={api.enabled}
            onCheckedChange={(enabled) => run(() => toggle({ data: { enabled } }), { success: enabled ? 'API access enabled' : 'API access disabled' })}
          />
        </Field>
        <div className={api.enabled ? 'space-y-4' : 'pointer-events-none space-y-4 opacity-50'}>
        {api.tokens.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Scope</TableHead><TableHead>Last used</TableHead><TableHead>Expires</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {api.tokens.map((t) => (
                <TableRow key={t.id}>
                  <TableCell><div className="font-medium">{t.name}</div><div className="text-muted-foreground font-mono text-xs">cbc_{t.prefix}_…</div></TableCell>
                  <TableCell><Badge variant={t.scope === 'run' ? 'default' : 'secondary'}>{t.scope === 'run' ? 'Run backups' : 'Read only'}</Badge></TableCell>
                  <TableCell className="text-sm">{t.last_used_at ? timeAgo(t.last_used_at) : 'never'}</TableCell>
                  <TableCell className="text-sm">{t.expires_at ? timeAgo(t.expires_at) : 'never'}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => run(() => revoke({ data: { id: t.id } }), { success: 'Token revoked' })}>Revoke</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {api.jobs.length > 0 && (
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs">Job IDs</div>
            {api.jobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{j.name}</span>
                <code className="bg-muted rounded px-1.5 text-xs">{j.id}</code>
              </div>
            ))}
          </div>
        )}
        <div>
          <div className="text-muted-foreground mb-1 text-xs">GitHub Actions step</div>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">{snippet}</pre>
        </div>
        </div>
      </CardContent>
      <CardFooter><Button disabled={!api.enabled} onClick={() => setOpen(true)}><Plus /> New token</Button></CardFooter>
      {open && <NewTokenDialog onClose={() => setOpen(false)} />}
    </Card>
  )
}

/** Mounted fresh each time, so scope/expiry/token never leak from a previous token. */
function NewTokenDialog({ onClose }: { onClose: () => void }) {
  const create = useServerFn(createApiToken)
  const { run, pending } = useAction()
  const [scope, setScope] = useState<'read' | 'run'>('run')
  const [expiry, setExpiry] = useState('365')
  const [created, setCreated] = useState<string | null>(null)
  const setOpen = (o: boolean) => {
    if (!o) onClose()
  }
  return (
      <Dialog open onOpenChange={setOpen}>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your token</DialogTitle>
                <DialogDescription>It won't be shown again. Store it as a CI secret, e.g. BACKUP_CONSOLE_TOKEN.</DialogDescription>
              </DialogHeader>
              <pre className="bg-muted my-4 overflow-x-auto rounded-md p-3 font-mono text-xs">{created}</pre>
              <DialogFooter>
                <Button variant="outline" onClick={() => navigator.clipboard.writeText(created).then(() => toast.success('Token copied'))}><Copy /> Copy</Button>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                const name = String(new FormData(e.currentTarget).get('name'))
                const r = await run(() => create({ data: { name, scope, expiresInDays: expiry === 'never' ? null : Number(expiry) } }), { success: 'Token created' })
                if (r) setCreated(r.token)
              }}
            >
              <DialogHeader>
                <DialogTitle>New API token</DialogTitle>
                <DialogDescription>Scoped to this workspace.</DialogDescription>
              </DialogHeader>
              <FieldGroup className="py-6">
                <Field>
                  <FieldLabel htmlFor="tok-name">Name</FieldLabel>
                  <Input id="tok-name" name="name" placeholder="github-actions-acme" required autoFocus />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>Scope</FieldLabel>
                    <Select value={scope} onValueChange={(v) => setScope(v as 'read' | 'run')}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="run">Run backups + read status</SelectItem>
                        <SelectItem value="read">Read status only</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Expires</FieldLabel>
                    <Select value={expiry} onValueChange={setExpiry}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">In 30 days</SelectItem>
                        <SelectItem value="90">In 90 days</SelectItem>
                        <SelectItem value="365">In 1 year</SelectItem>
                        <SelectItem value="never">Never</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={pending}>Create token</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
  )
}

import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Check, Copy, ImageUp, KeyRound, Mail, Plus, Terminal, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { AuthShell } from '~/components/auth-shell'
import { slugify } from '~/components/create-workspace'
import { SetupSteps } from '~/components/setup-steps'
import { WorkspaceLogo } from '~/components/workspace-logo'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { authClient } from '~/lib/auth-client'
import { ROLE_INFO, ROLES, type Role } from '~/lib/permissions'
import { createWorkspace, inviteMember, saveSmtpSettings, testSmtp } from '~/server/fns'
import { claimConsole, completeOnboarding, getSetup } from '~/server/setup-fns'

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    const setup = await getSetup()
    if (setup.step === 'done') throw redirect({ to: '/' })
    if (setup.step === 'signin') throw redirect({ to: '/login', search: { step: 'password', next: '/setup' } })
    if (setup.step === 'security') throw redirect({ to: '/security' })
    return { setup }
  },
  component: Setup,
})

type Setup = Awaited<ReturnType<typeof getSetup>>

function Setup() {
  const { setup } = Route.useRouteContext()
  const step = setup.step as 'account' | 'workspace' | 'team'
  return (
    <AuthShell wide top={<SetupSteps current={step} />}>
      {step === 'account' && <AccountStep />}
      {step === 'workspace' && <WorkspaceStep setup={setup} />}
      {step === 'team' && <TeamStep setup={setup} />}
    </AuthShell>
  )
}

function ErrorNote({ error }: { error: string | null }) {
  return error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null
}

// ── 1. Claim the console ─────────────────────────────────────

function AccountStep() {
  const claim = useServerFn(claimConsole)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Card>
      <form
        method="post"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
          if (f.password !== f.confirm) return setError("The passwords don't match")
          setBusy(true)
          setError(null)
          try {
            await claim({ data: { code: f.code, name: f.name, email: f.email, password: f.password } })
            const res = await authClient.signIn.email({ email: f.email, password: f.password })
            if (res.error) throw new Error(res.error.message ?? 'Sign-in failed')
            window.location.href = '/security'
          } catch (err) {
            setBusy(false)
            setError(err instanceof Error ? err.message : String(err))
          }
        }}
      >
        <CardHeader>
          <CardTitle className="text-xl">Welcome! Let’s set up your console</CardTitle>
          <CardDescription>Create the first admin account. You’ll then add a second factor, your first workspace and your team.</CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="code"><KeyRound className="size-4" /> Setup code</FieldLabel>
              <Input id="code" name="code" required autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" className="font-mono uppercase tracking-wider" />
              <FieldDescription className="flex items-start gap-1.5">
                <Terminal className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Printed in the console’s logs when it starts (in Coolify: your service → <strong>Logs</strong>; with Docker: <code>docker logs &lt;container&gt;</code>). It proves you run this server.
                </span>
              </FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="name">Your name</FieldLabel>
                <Input id="name" name="name" required autoComplete="name" />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" required autoComplete="username" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" />
                <FieldDescription>At least 12 characters.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
                <Input id="confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" />
              </Field>
            </div>
            <ErrorNote error={error} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="border-t">
          <Button type="submit" disabled={busy} className="w-full sm:w-auto">{busy ? 'Creating your account…' : 'Create admin account'}</Button>
        </CardFooter>
      </form>
    </Card>
  )
}

// ── 3. First workspace ───────────────────────────────────────

function WorkspaceStep({ setup }: { setup: Setup }) {
  const create = useServerFn(createWorkspace)
  const router = useRouter()
  const browserTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [timezone, setTimezone] = useState(setup.timezones.includes(browserTz) ? browserTz : 'UTC')
  const [logo, setLogo] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  function pickLogo(f: File | undefined) {
    if (!f) return
    if (!['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'].includes(f.type)) return setError('Use a PNG, JPG, SVG or WebP logo')
    if (f.size > 512 * 1024) return setError('The logo must be 512 KB or smaller')
    setError(null)
    setLogo(f)
    setPreview(URL.createObjectURL(f))
  }

  return (
    <Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await create({ data: { name, slug, timezone } })
            if (logo) {
              const body = new FormData()
              body.append('file', logo)
              const res = await fetch('/api/logo', { method: 'POST', body })
              if (!res.ok) toast.error(`Workspace created, but the logo upload failed: ${((await res.json()) as { error?: string }).error ?? res.status}`)
            }
            await router.invalidate()
          } catch (err) {
            setBusy(false)
            setError(err instanceof Error ? err.message : String(err))
          }
        }}
      >
        <CardHeader>
          <CardTitle className="text-xl">Create your first workspace</CardTitle>
          <CardDescription>
            A workspace holds instances, storage, schedules, alerts, an encryption key and members — for example one per client or team. You can add more later.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup>
            <div className="flex items-center gap-4">
              {preview ? (
                <img src={preview} alt="" className="size-14 rounded-lg border object-contain" />
              ) : (
                <WorkspaceLogo name={name || '?'} logo={null} className="size-14 rounded-lg text-lg" />
              )}
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()}>
                    <ImageUp /> {logo ? 'Change logo' : 'Upload logo'}
                  </Button>
                  {logo && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setLogo(null); setPreview(null) }}>
                      <X /> Remove
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">Optional. PNG, JPG, SVG or WebP up to 512 KB — shown in the app and on emails.</p>
              </div>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" aria-label="Workspace logo" onChange={(e) => pickLogo(e.target.files?.[0])} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
                <Input
                  id="ws-name"
                  value={name}
                  required
                  autoFocus
                  placeholder="Acme Agency"
                  onChange={(e) => {
                    setName(e.target.value)
                    if (!slugTouched) setSlug(slugify(e.target.value))
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ws-slug">Slug</FieldLabel>
                <Input id="ws-slug" value={slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={(e) => { setSlugTouched(true); setSlug(e.target.value) }} />
              </Field>
            </div>
            <Field>
              <FieldLabel>Timezone</FieldLabel>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="w-full" aria-label="Timezone"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {setup.timezones.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldDescription>Schedules, digests and emails use it (“daily at 03:00” means 03:00 here).</FieldDescription>
            </Field>
            <ErrorNote error={error} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="border-t">
          <Button type="submit" disabled={busy || !name || !slug}>{busy ? 'Creating…' : 'Create workspace'}</Button>
        </CardFooter>
      </form>
    </Card>
  )
}

// ── 4. Invite the team ───────────────────────────────────────

type Row = { email: string; role: Role }
type Sent = { email: string; link: string; emailed: boolean }

function TeamStep({ setup }: { setup: Setup }) {
  const invite = useServerFn(inviteMember)
  const finish = useServerFn(completeOnboarding)
  const [rows, setRows] = useState<Row[]>([{ email: '', role: 'admin' }])
  const [sent, setSent] = useState<Sent[]>([])
  const [smtp, setSmtp] = useState(setup.smtp)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ws = setup.workspace

  async function done() {
    setBusy(true)
    await finish()
    window.location.href = '/'
  }

  async function send() {
    setBusy(true)
    setError(null)
    const todo = rows.filter((r) => r.email.trim())
    const failed: Row[] = []
    for (const r of todo) {
      try {
        const res = await invite({ data: { email: r.email.trim(), role: r.role } })
        setSent((s) => [...s.filter((x) => x.email !== r.email.trim().toLowerCase()), { email: r.email.trim().toLowerCase(), link: res.link, emailed: res.emailed }])
      } catch (err) {
        failed.push(r)
        setError(`${r.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setRows(failed.length ? failed : [{ email: '', role: 'admin' }])
    setBusy(false)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            {ws && <WorkspaceLogo name={ws.name} logo={ws.logo} className="size-10 rounded-lg" />}
            <div>
              <CardTitle className="text-xl">Invite your team{ws ? ` to ${ws.name}` : ''}</CardTitle>
              <CardDescription>Each person sets a password (or uses Google, GitHub, Microsoft) and a second factor when they accept.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 py-6">
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  type="email"
                  aria-label={`Email ${i + 1}`}
                  placeholder="teammate@example.com"
                  value={r.email}
                  onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, email: e.target.value } : y)))}
                />
                <Select value={r.role} onValueChange={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, role: v as Role } : y)))}>
                  <SelectTrigger className="w-36 shrink-0" aria-label={`Role ${i + 1}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => (
                      <SelectItem key={role} value={role}>{ROLE_INFO[role].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((x) => [...x, { email: '', role: 'operator' }])}>
              <Plus /> Add another
            </Button>
          </div>
          <ul className="text-muted-foreground space-y-0.5 text-xs">
            {ROLES.map((role) => <li key={role}><span className="text-foreground font-medium">{ROLE_INFO[role].label}:</span> {ROLE_INFO[role].description}</li>)}
          </ul>
          {!smtp && <SmtpInline onSaved={() => setSmtp(true)} />}
          <ErrorNote error={error} />
          {sent.length > 0 && (
            <div className="divide-y rounded-md border">
              {sent.map((s) => (
                <div key={s.email} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Check className="size-4 shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1 truncate">{s.email}</span>
                  {s.emailed ? (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs"><Mail className="size-3" /> emailed</span>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(s.link).then(() => toast.success('Invitation link copied'))}>
                      <Copy /> Copy link
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex-wrap gap-2 border-t">
          <Button type="button" disabled={busy || !rows.some((r) => r.email.trim())} onClick={send}>
            <Mail /> Send invitations
          </Button>
          <Button type="button" variant={sent.length ? 'default' : 'ghost'} className="ml-auto" disabled={busy} onClick={done}>
            {sent.length ? 'Finish' : 'Skip for now'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

/** Optional platform SMTP so invitations (and later alerts) are emailed instead of copied. */
function SmtpInline({ onSaved }: { onSaved: () => void }) {
  const save = useServerFn(saveSmtpSettings)
  const test = useServerFn(testSmtp)
  const [open, setOpen] = useState(false)
  const [secure, setSecure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) {
    return (
      <div className="bg-muted/50 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5 text-sm">
        <Mail className="text-muted-foreground size-4" />
        <span className="flex-1">No email server yet — you’ll get links to share yourself.</span>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Set up email</Button>
      </div>
    )
  }
  return (
    <div className="rounded-md border p-4">
      <p className="mb-3 text-sm font-medium">Email server (SMTP)</p>
      <FieldGroup>
        <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
          <Field><FieldLabel htmlFor="smtp-host">Host</FieldLabel><Input id="smtp-host" placeholder="smtp.postmarkapp.com" /></Field>
          <Field><FieldLabel htmlFor="smtp-port">Port</FieldLabel><Input id="smtp-port" type="number" defaultValue={587} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="smtp-user">Username</FieldLabel><Input id="smtp-user" autoComplete="off" /></Field>
          <Field><FieldLabel htmlFor="smtp-pass">Password</FieldLabel><Input id="smtp-pass" type="password" autoComplete="new-password" /></Field>
        </div>
        <Field><FieldLabel htmlFor="smtp-from">From</FieldLabel><Input id="smtp-from" placeholder="Backups <backups@example.com>" /></Field>
        <Field orientation="horizontal">
          <Checkbox id="smtp-secure" checked={secure} onCheckedChange={(v) => setSecure(v === true)} />
          <FieldLabel htmlFor="smtp-secure" className="font-normal">Use TLS from the start (port 465)</FieldLabel>
        </Field>
        <ErrorNote error={error} />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={async () => {
              const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim()
              setBusy(true)
              setError(null)
              try {
                await save({ data: { host: v('smtp-host'), port: Number(v('smtp-port')), secure, user: v('smtp-user') || undefined, pass: v('smtp-pass') || undefined, from: v('smtp-from') } })
                await test()
                toast.success('Email works — we sent you a test')
                onSaved()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              } finally {
                setBusy(false)
              }
            }}
          >
            Save and send a test
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </FieldGroup>
    </div>
  )
}

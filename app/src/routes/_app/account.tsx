import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CalendarDays, Fingerprint, Link2, LogOut, Mail, Monitor, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Confirm } from '~/components/confirm'
import { PageBody, PageHeader } from '~/components/page'
import { PROVIDERS, type ProviderId } from '~/components/provider-icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { authClient } from '~/lib/auth-client'
import { timeAgo } from '~/lib/format'
import { ROLE_INFO } from '~/lib/permissions'
import { Switch } from '~/components/ui/switch'
import { useAction } from '~/lib/use-action'
import { getEmailPreferences, setEmailOptOut } from '~/server/email-fns'
import { getAuthProviders, getUser } from '~/server/fns'

export const Route = createFileRoute('/_app/account')({
  loader: async () => ({ providers: (await getAuthProviders()).providers, me: await getUser(), emails: await getEmailPreferences() }),
  component: Account,
})

type Session = { id: string; token: string; ipAddress?: string | null; userAgent?: string | null; createdAt: Date; updatedAt: Date; mfa?: string | null }
type Passkey = { id: string; name?: string | null; createdAt: Date; deviceType: string }
type Account = { providerId: string; accountId: string }

function describeAgent(ua?: string | null) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return `${browser}${os ? ` on ${os}` : ''}`
}

const isMobileAgent = (ua?: string | null) => Boolean(ua && /iPhone|iPad|Android/.test(ua))

/** Crude strength read for the new-password meter — length + character-class variety. Purely a
 * visual hint; the server still enforces the 12-character minimum regardless of this score. */
function passwordStrength(pw: string) {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

function Account() {
  const { app } = Route.useRouteContext()
  const { providers, me } = Route.useLoaderData()
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [createdAt, setCreatedAt] = useState<Date | null>(null)

  async function load() {
    const [s, p, a, c] = await Promise.all([
      authClient.listSessions(),
      authClient.passkey.listUserPasskeys(),
      authClient.listAccounts(),
      authClient.getSession(),
    ])
    setSessions((s.data ?? []) as Session[])
    setPasskeys((p.data ?? []) as Passkey[])
    setAccounts((a.data ?? []) as Account[])
    setCurrent(c.data?.session.token ?? null)
    setCreatedAt(c.data?.user.createdAt ? new Date(c.data.user.createdAt) : null)
  }
  useEffect(() => void load(), [])

  const factorCount = (me?.hasTotp ? 1 : 0) + passkeys.length
  const linked = new Set(accounts.map((a) => a.providerId))
  const initials = app.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <>
      <PageHeader title="Account & security" description={app.user.email} />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="bg-muted flex size-10 items-center justify-center rounded-full text-sm font-semibold">{initials}</div>
            <div>
              <div className="text-sm font-medium">{app.user.name}</div>
              <div className="text-muted-foreground text-xs">{app.user.email}</div>
            </div>
          </div>
          {createdAt && (
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <CalendarDays className="size-3.5" /> Account created {createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Second factors</CardTitle>
                <CardDescription>Required before restores and destructive workspace actions.</CardDescription>
              </div>
              <span className="text-muted-foreground font-mono text-xs">{factorCount} active</span>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-2 text-sm"><Smartphone className="size-4" /> Authenticator app</div>
                {me?.hasTotp ? <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">Enabled</Badge> : <Badge variant="outline">Not set up</Badge>}
              </div>
              {passkeys.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="text-sm">
                    <div className="flex items-center gap-2"><Fingerprint className="size-4" /> {p.name || 'Passkey'}</div>
                    <div className="text-muted-foreground text-xs">added {timeAgo(new Date(p.createdAt).getTime())} · {p.deviceType === 'multiDevice' ? 'synced' : 'this device'}</div>
                  </div>
                  <Confirm
                    trigger={<Button size="icon" variant="ghost" disabled={factorCount <= 1} aria-label="Remove passkey"><Trash2 /></Button>}
                    title="Remove this passkey?"
                    description="You won't be able to sign in with it any more."
                    action="Remove"
                    onConfirm={async () => {
                      const res = await authClient.passkey.deletePasskey({ id: p.id })
                      if (res.error) return toast.error(res.error.message ?? 'Failed')
                      toast.success('Passkey removed')
                      await load()
                    }}
                  />
                </div>
              ))}
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                onClick={async () => {
                  const res = await authClient.passkey.addPasskey({ name: navigator.platform || 'Passkey' })
                  if (res?.error) return toast.error(res.error.message ?? 'Could not add passkey')
                  toast.success('Passkey added')
                  await load()
                  await router.invalidate()
                }}
              >
                <Fingerprint /> Add a passkey
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Link2 className="size-4" /> Connected accounts</CardTitle>
              <CardDescription>Sign in with these instead of a password. Your second factor is still required.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {providers.length === 0 && <p className="text-muted-foreground text-sm">No sign-in providers are configured on this console.</p>}
              {(providers as ProviderId[]).map((p) => {
                const { label, icon: Icon } = PROVIDERS[p]
                return (
                  <div key={p} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-2 text-sm"><Icon /> {label}</div>
                    {linked.has(p) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={accounts.length <= 1}
                        onClick={async () => {
                          const acct = accounts.find((a) => a.providerId === p)!
                          const res = await authClient.unlinkAccount({ accountId: acct.accountId })
                          if (res.error) return toast.error(res.error.message ?? 'Failed')
                          toast.success(`${label} disconnected`)
                          await load()
                        }}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => authClient.linkSocial({ provider: p, callbackURL: '/account' })}>
                        Connect
                      </Button>
                    )}
                  </div>
                )
              })}
              <div className="text-muted-foreground pt-2 text-xs">
                Workspaces: {app.workspaces.map((w) => `${w.name} (${ROLE_INFO[w.role].label})`).join(', ') || '—'}
                {app.user.isPlatformAdmin && ' · Platform admin'}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Active sessions</CardTitle>
              <CardDescription>Every device currently signed in to your account. Sign out anything you don't recognise.</CardDescription>
            </div>
            <span className="text-muted-foreground font-mono text-xs">{sessions.length} sessions</span>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {sessions.map((s) => {
                const mobile = isMobileAgent(s.userAgent)
                const DeviceIcon = mobile ? Smartphone : Monitor
                return (
                <li key={s.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${s.token === current ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      <DeviceIcon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {describeAgent(s.userAgent)} {s.token === current && <Badge variant="secondary" className="ml-1">This device</Badge>}
                      </div>
                      <div className="text-muted-foreground truncate text-xs">
                        {s.ipAddress || 'unknown IP'} · signed in {timeAgo(new Date(s.createdAt).getTime())} ·{' '}
                        {s.mfa === 'passkey' ? 'passkey' : s.mfa === 'totp' ? 'authenticator verified' : 'not verified'}
                      </div>
                    </div>
                  </div>
                  {s.token !== current && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await authClient.revokeSession({ token: s.token })
                        toast.success('Session signed out')
                        await load()
                      }}
                    >
                      <LogOut /> Sign out
                    </Button>
                  )}
                </li>
                )
              })}
            </ul>
          </CardContent>
          {sessions.length > 1 && (
            <CardFooter>
              <Button
                variant="outline"
                onClick={async () => {
                  await authClient.revokeOtherSessions()
                  toast.success('Signed out everywhere else')
                  await load()
                }}
              >
                Sign out all other sessions
              </Button>
            </CardFooter>
          )}
        </Card>

        <EmailPreferences prefs={Route.useLoaderData().emails} />
        {me?.hasPassword && <PasswordCard />}
      </PageBody>
    </>
  )
}

function EmailPreferences({ prefs }: { prefs: Awaited<ReturnType<typeof getEmailPreferences>> }) {
  const set = useServerFn(setEmailOptOut)
  const { run } = useAction()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="size-4" /> Email preferences</CardTitle>
        <CardDescription>
          Emails your workspaces send you. Invitations, role changes and security emails (password, passkeys, 2FA resets) are always sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {prefs.workspaces.map((w) => (
          <div key={w.id}>
            <div className="mb-2 text-sm font-medium">{w.name}</div>
            <div className="divide-y rounded-md border">
              {w.types.map((t) => (
                <label key={t.type} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className={t.receives ? '' : 'text-muted-foreground'}>
                    {t.label}
                    {!t.receives && <span className="text-xs"> · not sent to you</span>}
                  </span>
                  <Switch
                    aria-label={`${w.name}: ${t.label}`}
                    disabled={!t.receives}
                    checked={t.receives && !t.optedOut}
                    onCheckedChange={(on) => run(() => set({ data: { workspaceId: w.id, type: t.type, optOut: !on } }), { success: on ? `${t.label} emails on` : `${t.label} emails off` })}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong']

function PasswordCard() {
  const [pending, setPending] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const strength = useMemo(() => passwordStrength(newPassword), [newPassword])
  return (
    <Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          if (f.get('newPassword') !== f.get('confirm')) return toast.error('Passwords do not match')
          setPending(true)
          const res = await authClient.changePassword({
            currentPassword: String(f.get('currentPassword')),
            newPassword: String(f.get('newPassword')),
            revokeOtherSessions: true,
          })
          setPending(false)
          if (res.error) return toast.error(res.error.message ?? 'Could not change password')
          toast.success('Password changed — other sessions were signed out')
          form.reset()
          setNewPassword('')
        }}
      >
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>At least 12 characters. You'll stay signed in on this device.</CardDescription>
        </CardHeader>
        <CardContent className="py-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="newPassword">New password</FieldLabel>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <div className="mt-1.5 flex gap-1" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i < strength ? (strength <= 1 ? 'bg-danger' : strength === 2 ? 'bg-warning' : 'bg-success') : 'bg-muted'}`}
                  />
                ))}
              </div>
              <FieldDescription>{newPassword ? STRENGTH_LABEL[strength] : 'At least 12 characters.'}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
              <FieldDescription>Must match the new password.</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="items-center justify-between">
          <span className="text-muted-foreground text-xs">Other sessions will be signed out after the change.</span>
          <Button type="submit" disabled={pending}>Update password</Button>
        </CardFooter>
      </form>
    </Card>
  )
}

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Fingerprint, LogOut, Monitor, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { getAuthProviders, getUser } from '~/server/fns'

export const Route = createFileRoute('/_app/account')({
  loader: async () => ({ providers: (await getAuthProviders()).providers, me: await getUser() }),
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

function Account() {
  const { app } = Route.useRouteContext()
  const { providers, me } = Route.useLoaderData()
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [current, setCurrent] = useState<string | null>(null)

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
  }
  useEffect(() => void load(), [])

  const factorCount = (me?.hasTotp ? 1 : 0) + passkeys.length
  const linked = new Set(accounts.map((a) => a.providerId))

  return (
    <>
      <PageHeader title="Account & security" description={app.user.email} />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Second factors</CardTitle>
              <CardDescription>Every session must be verified with one of these.</CardDescription>
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
              <CardTitle>Connected accounts</CardTitle>
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
          <CardHeader>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Devices signed in to your account. Sign out anything you don't recognise.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Monitor className="text-muted-foreground size-4 shrink-0" />
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
              ))}
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

        {me?.hasPassword && <PasswordCard />}
      </PageBody>
    </>
  )
}

function PasswordCard() {
  const [pending, setPending] = useState(false)
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
        }}
      >
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Signs out every other session.</CardDescription>
        </CardHeader>
        <CardContent className="py-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="newPassword">New password</FieldLabel>
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
              <FieldDescription>At least 12 characters.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter><Button type="submit" disabled={pending}>Change password</Button></CardFooter>
      </form>
    </Card>
  )
}

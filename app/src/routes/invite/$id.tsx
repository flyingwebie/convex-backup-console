import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AuthShell } from '~/components/auth-shell'
import { WorkspaceLogo } from '~/components/workspace-logo'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { authClient } from '~/lib/auth-client'
import { ROLE_INFO, type Role } from '~/lib/permissions'
import { getAuthProviders, getInvitation, getUser, registerFromInvitation } from '~/server/fns'
import { OrDivider, SocialButtons } from '~/components/social-buttons'

export const Route = createFileRoute('/invite/$id')({
  loader: async ({ params }) => ({
    invitation: await getInvitation({ data: { id: params.id } }),
    user: await getUser(),
    providers: (await getAuthProviders()).providers,
  }),
  component: Invite,
})

function Invite() {
  const { invitation: inv, user, providers } = Route.useLoaderData()
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const register = useServerFn(registerFromInvitation)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!inv || inv.status !== 'pending' || inv.expired) {
    return (
      <AuthShell>
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Invitation unavailable</CardTitle>
            <CardDescription>
              {!inv ? 'This link is not valid.' : inv.status === 'accepted' ? 'It has already been accepted.' : 'It has expired or was cancelled. Ask for a new one.'}
            </CardDescription>
          </CardHeader>
          <CardContent><Button asChild className="w-full"><Link to="/login" search={{ step: 'password' }}>Go to sign in</Link></Button></CardContent>
        </Card>
      </AuthShell>
    )
  }

  async function accept() {
    setBusy(true)
    setError(null)
    const res = await authClient.organization.acceptInvitation({ invitationId: id })
    setBusy(false)
    if (res.error) return setError(res.error.message ?? 'Could not accept the invitation')
    await authClient.organization.setActive({ organizationId: res.data?.member.organizationId ?? null })
    await navigate({ to: !user?.twoFactorEnabled ? '/security' : user.sessionFactor ? '/' : '/verify' })
  }

  async function createAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const password = String(f.get('password'))
    if (password !== f.get('confirm')) return setError('Passwords do not match')
    setBusy(true)
    setError(null)
    try {
      const { email } = await register({ data: { id, name: String(f.get('name')), password } })
      const signIn = await authClient.signIn.email({ email, password })
      if (signIn.error) throw new Error(signIn.error.message)
      const res = await authClient.organization.acceptInvitation({ invitationId: id })
      if (res.error) throw new Error(res.error.message)
      await authClient.organization.setActive({ organizationId: res.data?.member.organizationId ?? null })
      await navigate({ to: '/security' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const header = (
    <CardHeader className="items-center text-center">
      <WorkspaceLogo name={inv.workspace} logo={inv.logo} className="mx-auto mb-2 size-12 rounded-xl" />
      <CardTitle className="text-xl">Join {inv.workspace}</CardTitle>
      <CardDescription>
        You're invited as <strong>{ROLE_INFO[inv.role as Role]?.label ?? inv.role}</strong> ({inv.email}).
      </CardDescription>
    </CardHeader>
  )

  return (
    <AuthShell>
      <Card>
        {header}
        <CardContent>
          {user ? (
            user.email === inv.email ? (
              <FieldGroup>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button onClick={accept} disabled={busy}>{busy ? 'Joining…' : 'Accept invitation'}</Button>
              </FieldGroup>
            ) : (
              <Alert variant="destructive">
                <AlertDescription>
                  You're signed in as {user.email}. Sign out and open this link again to accept as {inv.email}.
                </AlertDescription>
              </Alert>
            )
          ) : inv.userExists ? (
            <Button asChild className="w-full">
              <Link to="/login" search={{ step: 'password', next: `/invite/${id}` }}>Sign in to accept</Link>
            </Button>
          ) : (
            <form method="post" onSubmit={createAccount}>
              <FieldGroup>
                {providers.length > 0 && (
                  <>
                    <SocialButtons providers={providers} callbackURL={`/invite/${id}`} label="Join with" />
                    <OrDivider />
                  </>
                )}
                <Field>
                  <FieldLabel htmlFor="name">Your name</FieldLabel>
                  <Input id="name" name="name" required autoFocus autoComplete="name" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input id="password" name="password" type="password" minLength={12} required autoComplete="new-password" />
                  <FieldDescription>At least 12 characters. You'll set up 2FA next.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
                  <Input id="confirm" name="confirm" type="password" minLength={12} required autoComplete="new-password" />
                </Field>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account & join'}</Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  )
}

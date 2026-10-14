import { createFileRoute, redirect } from '@tanstack/react-router'
import { Fingerprint } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { AuthShell } from '~/components/auth-shell'
import { OrDivider, SocialButtons } from '~/components/social-buttons'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '~/components/ui/input-otp'
import { authClient } from '~/lib/auth-client'
import { getAuthProviders, getUser } from '~/server/fns'

// Only same-origin paths, so ?next= can't redirect off-site.
const safeNext = (next?: string) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/')

const ERRORS: Record<string, string> = {
  no_invitation: "There's no account for that email. Ask a workspace owner to invite you.",
  account_not_linked: 'That email is already registered with another sign-in method. Sign in with it first, then link this provider in Account.',
  unable_to_create_user: "There's no account for that email. Ask a workspace owner to invite you.",
}

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ step: z.enum(['password', 'totp']).default('password'), next: z.string().optional(), error: z.string().optional() }),
  beforeLoad: async ({ search }) => {
    const user = await getUser()
    if (user && search.step === 'password') throw redirect({ href: safeNext(search.next) })
  },
  loader: () => getAuthProviders(),
  component: Login,
})

function Login() {
  const { step, next, error: errorParam } = Route.useSearch()
  const { providers } = Route.useLoaderData()
  const [error, setError] = useState<string | null>(errorParam ? (ERRORS[errorParam.toLowerCase()] ?? errorParam.replaceAll('_', ' ')) : null)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const target = safeNext(next)

  async function finish(res: { error: { message?: string } | null; data?: unknown }) {
    setBusy(false)
    if (res.error) return setError(res.error.message ?? 'Sign-in failed')
    const twoFactor = res.data && typeof res.data === 'object' && 'twoFactorRedirect' in res.data
    if (step === 'totp' || !twoFactor) window.location.href = target
  }

  async function submitPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    await finish(await authClient.signIn.email({ email: String(f.get('email')), password: String(f.get('password')) }))
  }

  async function submitCode(value: string) {
    setBusy(true)
    setError(null)
    const res = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: value })
      : await authClient.twoFactor.verifyTotp({ code: value, trustDevice: false })
    if (res.error) setCode('')
    await finish(res)
  }

  async function passkeySignIn() {
    setBusy(true)
    setError(null)
    const res = await authClient.signIn.passkey()
    setBusy(false)
    if (res?.error) return setError(res.error.message ?? 'Passkey sign-in failed')
    window.location.href = target
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{step === 'totp' ? 'Two-factor code' : 'Sign in'}</CardTitle>
          <CardDescription>
            {step === 'totp' ? (useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.') : 'Access is limited to invited members.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'totp' ? (
            <form onSubmit={(e) => { e.preventDefault(); void submitCode(code) }}>
              <FieldGroup>
                {useBackup ? (
                  <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="xxxxx-xxxxx" autoFocus autoComplete="off" />
                ) : (
                  <div className="flex justify-center">
                    <InputOTP maxLength={6} value={code} onChange={setCode} onComplete={submitCode} autoFocus disabled={busy}>
                      <InputOTPGroup>{Array.from({ length: 6 }, (_, i) => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
                    </InputOTP>
                  </div>
                )}
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button type="submit" disabled={busy || code.length < 6}>{busy ? 'Verifying…' : 'Verify'}</Button>
                <Button type="button" variant="link" size="sm" onClick={() => { setUseBackup(!useBackup); setCode(''); setError(null) }}>
                  {useBackup ? 'Use authenticator app' : 'Lost your device? Use a backup code'}
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <FieldGroup>
              <SocialButtons providers={providers} callbackURL={target} />
              <Button type="button" variant="outline" disabled={busy} onClick={passkeySignIn}>
                <Fingerprint /> Sign in with a passkey
              </Button>
              <OrDivider />
              <form onSubmit={submitPassword}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input id="email" name="email" type="email" autoComplete="username webauthn" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Input id="password" name="password" type="password" autoComplete="current-password" required />
                  </Field>
                  {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                  <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
                </FieldGroup>
              </form>
            </FieldGroup>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  )
}

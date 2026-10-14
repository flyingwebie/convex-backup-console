import { createFileRoute, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Fingerprint, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { AuthShell } from '~/components/auth-shell'
import { OrDivider } from '~/components/social-buttons'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { FieldGroup } from '~/components/ui/field'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '~/components/ui/input-otp'
import { authClient } from '~/lib/auth-client'
import { getUser, stepUp } from '~/server/fns'

// Step-up after a social sign-in: Google/GitHub/Microsoft prove identity, the second factor is still ours.
export const Route = createFileRoute('/verify')({
  validateSearch: z.object({ next: z.string().optional() }),
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login', search: { step: 'password' } })
    if (!user.twoFactorEnabled) throw redirect({ to: '/security' })
    if (user.sessionFactor) throw redirect({ to: '/' })
    return { user }
  },
  component: Verify,
})

function Verify() {
  const { user } = Route.useRouteContext()
  const { next } = Route.useSearch()
  const verify = useServerFn(stepUp)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'

  async function submit(value: string) {
    setBusy(true)
    setError(null)
    try {
      await verify({ data: { code: value } })
      window.location.href = target
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCode('')
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader className="text-center">
          <ShieldCheck className="text-primary mx-auto mb-1 size-8" />
          <CardTitle className="text-xl">Confirm it's you</CardTitle>
          <CardDescription>Signed in as {user.email}. Every session needs your second factor.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {user.hasTotp && (
              <form onSubmit={(e) => { e.preventDefault(); void submit(code) }} className="grid gap-4">
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={code} onChange={setCode} onComplete={submit} autoFocus disabled={busy}>
                    <InputOTPGroup>{Array.from({ length: 6 }, (_, i) => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
                  </InputOTP>
                </div>
                <Button type="submit" disabled={busy || code.length < 6}>Verify code</Button>
              </form>
            )}
            {user.hasTotp && user.passkeys > 0 && <OrDivider />}
            {user.passkeys > 0 && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  const res = await authClient.signIn.passkey()
                  if (res?.error) return setError(res.error.message ?? 'Passkey failed')
                  window.location.href = target
                }}
              >
                <Fingerprint /> Use a passkey
              </Button>
            )}
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button variant="ghost" size="sm" onClick={async () => { await authClient.signOut(); window.location.href = '/login' }}>
              Sign out
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>
    </AuthShell>
  )
}

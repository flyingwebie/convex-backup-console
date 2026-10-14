import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { Copy } from 'lucide-react'
import QRCode from 'qrcode'
import { useState } from 'react'
import { toast } from 'sonner'
import { AuthShell } from '~/components/auth-shell'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '~/components/ui/input-otp'
import { authClient } from '~/lib/auth-client'
import { getUser } from '~/server/fns'

export const Route = createFileRoute('/security')({
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login', search: { step: 'password' } })
    if (user.twoFactorEnabled) throw redirect({ to: '/' })
    return { user }
  },
  component: Security,
})

function Security() {
  const router = useRouter()
  const [setup, setSetup] = useState<{ qr: string; secret: string; codes: string[] } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await authClient.twoFactor.enable({ password: String(new FormData(e.currentTarget).get('password')) })
    setBusy(false)
    if (res.error) return setError(res.error.message ?? 'Failed')
    if (res.data.method !== 'totp') return setError('Unexpected 2FA method')
    setSetup({
      qr: await QRCode.toDataURL(res.data.totpURI, { margin: 1, width: 220 }),
      secret: new URL(res.data.totpURI).searchParams.get('secret') ?? '',
      codes: res.data.backupCodes,
    })
  }

  async function verify(value: string) {
    setError(null)
    setBusy(true)
    const res = await authClient.twoFactor.verifyTotp({ code: value })
    setBusy(false)
    if (res.error) {
      setCode('')
      return setError(res.error.message ?? 'Invalid code')
    }
    toast.success('Two-factor authentication enabled')
    await router.navigate({ to: '/' })
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Set up two-factor authentication</CardTitle>
          <CardDescription>Required before you can manage backups.</CardDescription>
        </CardHeader>
        <CardContent>
          {!setup ? (
            <form onSubmit={start}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="password">Confirm your password</FieldLabel>
                  <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
                </Field>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button type="submit" disabled={busy}>Continue</Button>
              </FieldGroup>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void verify(code) }}>
              <FieldGroup>
                <div className="flex flex-col items-center gap-2">
                  <img src={setup.qr} alt="Scan with your authenticator app" width={180} height={180} className="rounded-md border bg-white p-1" />
                  <p className="text-muted-foreground text-center text-xs">
                    Scan with 1Password, Google Authenticator, Authy… or enter <code className="break-all">{setup.secret}</code>
                  </p>
                </div>
                <Field>
                  <FieldLabel>Backup codes</FieldLabel>
                  <div className="bg-muted grid grid-cols-2 gap-1 rounded-md p-3 font-mono text-xs">
                    {setup.codes.map((c) => <span key={c}>{c}</span>)}
                  </div>
                  <FieldDescription className="flex items-center justify-between">
                    Each works once if you lose your device. Save them now.
                    <Button type="button" variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(setup.codes.join('\n')).then(() => toast.success('Backup codes copied'))}>
                      <Copy /> Copy
                    </Button>
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Code from your app</FieldLabel>
                  <div className="flex justify-center">
                    <InputOTP maxLength={6} value={code} onChange={setCode} onComplete={verify} disabled={busy}>
                      <InputOTPGroup>
                        {Array.from({ length: 6 }, (_, i) => <InputOTPSlot key={i} index={i} />)}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                </Field>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button type="submit" disabled={busy || code.length < 6}>Verify and enable</Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  )
}

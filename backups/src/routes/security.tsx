import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import QRCode from 'qrcode'
import { useState } from 'react'
import { authClient } from '~/lib/auth-client'
import { getUser } from '~/server/fns'

export const Route = createFileRoute('/security')({
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login', search: { step: 'password' } })
    return { user }
  },
  component: Security,
})

function Security() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const [qr, setQr] = useState<string | null>(null)
  const [uri, setUri] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const res = await authClient.twoFactor.enable({ password: String(new FormData(e.currentTarget).get('password')) })
    if (res.error) return setError(res.error.message ?? 'Failed')
    if (res.data.method !== 'totp') return setError('Unexpected 2FA method')
    setUri(res.data.totpURI)
    setCodes(res.data.backupCodes)
    setQr(await QRCode.toDataURL(res.data.totpURI))
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const res = await authClient.twoFactor.verifyTotp({ code: String(new FormData(e.currentTarget).get('code')) })
    if (res.error) return setError(res.error.message ?? 'Invalid code')
    await router.navigate({ to: '/' })
  }

  if (user.twoFactorEnabled) {
    return (
      <main>
        <section className="card">
          <h2>Two-factor authentication</h2>
          <p>Enabled for {user.email}.</p>
          <a href="/">Back to dashboard</a>
        </section>
      </main>
    )
  }

  return (
    <main>
      <section className="card">
        <h2>Set up two-factor authentication</h2>
        <p className="muted">Required before you can manage backups.</p>
        {!uri ? (
          <form onSubmit={start}>
            <input name="password" type="password" placeholder="Confirm your password" required autoFocus />
            <button className="primary">Generate QR code</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            {qr && <img src={qr} alt="TOTP QR code" width={220} height={220} />}
            <p className="muted">
              Or enter manually: <code>{new URL(uri).searchParams.get('secret')}</code>
            </p>
            <p className="muted">Backup codes — store them in your password manager now:</p>
            <code>{codes.join('  ')}</code>
            <input name="code" inputMode="numeric" placeholder="Code from your app" required />
            <button className="primary">Verify and enable</button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  )
}

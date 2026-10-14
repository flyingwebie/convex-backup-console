import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { authClient } from '~/lib/auth-client'
import { getUser } from '~/server/fns'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ step: z.enum(['password', 'totp']).default('password') }),
  beforeLoad: async ({ search }) => {
    const user = await getUser()
    if (user && search.step === 'password') throw redirect({ to: '/' })
  },
  component: Login,
})

function Login() {
  const { step } = Route.useSearch()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    const res =
      step === 'totp'
        ? await authClient.twoFactor.verifyTotp({ code: String(form.get('code')), trustDevice: false })
        : await authClient.signIn.email({ email: String(form.get('email')), password: String(form.get('password')) })
    setBusy(false)
    if (res.error) return setError(res.error.message ?? 'Login failed')
    // A 2FA-enabled account is redirected to the TOTP step by the client plugin.
    if (step === 'totp' || !(res.data && 'twoFactorRedirect' in res.data && res.data.twoFactorRedirect)) {
      await navigate({ to: '/' })
    }
  }

  return (
    <main>
      <section className="card">
        <h2>{step === 'totp' ? 'Two-factor code' : 'Sign in'}</h2>
        <form onSubmit={submit}>
          {step === 'totp' ? (
            <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required autoFocus />
          ) : (
            <>
              <input name="email" type="email" autoComplete="username" placeholder="Email" required autoFocus />
              <input name="password" type="password" autoComplete="current-password" placeholder="Password" required />
            </>
          )}
          <button className="primary" disabled={busy}>
            {busy ? '…' : 'Continue'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>
    </main>
  )
}

import { createAuthClient } from 'better-auth/react'
import { twoFactorClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [twoFactorClient({ onTwoFactorRedirect: () => { window.location.href = '/login?step=totp' } })],
})

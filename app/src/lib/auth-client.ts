import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/react'
import { adminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      // Keep ?next= across the 2FA step (e.g. returning to an invitation).
      onTwoFactorRedirect: () => {
        const next = new URLSearchParams(window.location.search).get('next')
        window.location.href = `/login?step=totp${next ? `&next=${encodeURIComponent(next)}` : ''}`
      },
    }),
    organizationClient(),
    adminClient(),
    passkeyClient(),
  ],
})

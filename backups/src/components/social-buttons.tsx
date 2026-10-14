import { useState } from 'react'
import { PROVIDERS, type ProviderId } from '~/components/provider-icons'
import { Button } from '~/components/ui/button'
import { authClient } from '~/lib/auth-client'

export function SocialButtons({ providers, callbackURL, label = 'Continue with' }: { providers: ProviderId[]; callbackURL: string; label?: string }) {
  const [busy, setBusy] = useState<ProviderId | null>(null)
  if (providers.length === 0) return null
  return (
    <div className="grid gap-2">
      {providers.map((p) => {
        const { label: name, icon: Icon } = PROVIDERS[p]
        return (
          <Button
            key={p}
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(p)
              await authClient.signIn.social({ provider: p, callbackURL, errorCallbackURL: `/login?step=password` })
            }}
          >
            <Icon /> {label} {name}
          </Button>
        )
      })}
    </div>
  )
}

export function OrDivider() {
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <div className="bg-border h-px flex-1" /> or <div className="bg-border h-px flex-1" />
    </div>
  )
}

import type { ReactNode } from 'react'
import { useHydrated } from '@tanstack/react-router'
import { LifeBuoy } from 'lucide-react'

export function AuthShell({ children }: { children: ReactNode }) {
  // Until React has hydrated, a submit would be a plain HTML form post; keep the controls
  // disabled so credentials are only ever sent by our handlers.
  const hydrated = useHydrated()
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2 font-semibold">
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
          <LifeBuoy className="size-4" />
        </div>
        Convex Backup Console
      </div>
      <fieldset disabled={!hydrated} data-hydrated={hydrated} className="m-0 w-full max-w-sm min-w-0 border-0 p-0">
        {children}
      </fieldset>
    </div>
  )
}

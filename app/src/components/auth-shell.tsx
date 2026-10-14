import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { useHydrated } from '@tanstack/react-router'
import { AppLogo } from '~/components/app-logo'

export function AuthShell({ children, wide, top }: { children: ReactNode; wide?: boolean; top?: ReactNode }) {
  // Until React has hydrated, a submit would be a plain HTML form post; keep the controls
  // disabled so credentials are only ever sent by our handlers.
  const hydrated = useHydrated()
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3">
        <AppLogo className="size-14 drop-shadow-sm" />
        <span className="text-lg font-semibold tracking-tight">Convex Backup Console</span>
      </div>
      {top}
      <fieldset disabled={!hydrated} data-hydrated={hydrated} className={cn('m-0 w-full min-w-0 border-0 p-0', wide ? 'max-w-xl' : 'max-w-sm')}>
        {children}
      </fieldset>
    </div>
  )
}

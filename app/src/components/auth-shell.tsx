import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { useHydrated } from '@tanstack/react-router'
import { AppLogo } from '~/components/app-logo'
import { AuthVaultPanel, type VaultStage } from '~/components/auth-vault-panel'

/**
 * Two-pane shell for every unauthenticated/onboarding screen (login, verify, setup, security,
 * invite, no-workspace — DESIGN.md §6). Left: a ~44%-width dark "vault" brand panel that's always
 * dark regardless of the app's light/dark theme (an ops tool's server-room identity, not an
 * inverted light pane). Right: the form card on the page background. Collapses to a single column
 * on mobile — the vault panel is desktop-only; a compact header bar carries the logo instead.
 */
export function AuthShell({
  children,
  wide,
  top,
  vaultStage = 'graph',
  vaultCaption = 'Every backup is scheduled, encrypted, and verified before it leaves your infrastructure.',
  vaultMembers,
}: {
  children: ReactNode
  wide?: boolean
  /** Extra content above the card, inside the right pane (e.g. the setup wizard's step indicator). */
  top?: ReactNode
  vaultStage?: VaultStage
  vaultCaption?: string
  vaultMembers?: { initials: string[]; label: string }
}) {
  // Until React has hydrated, a submit would be a plain HTML form post; keep the controls
  // disabled so credentials are only ever sent by our handlers.
  const hydrated = useHydrated()
  return (
    <div className="flex min-h-svh">
      <aside className="relative hidden w-[44%] shrink-0 flex-col justify-between overflow-hidden bg-[#0b0d16] px-10 py-8 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 70% 50% at 30% 20%, rgb(255 255 255 / 0.05), transparent 70%)' }}
        />
        <div className="relative z-10 flex items-center gap-2.5">
          <AppLogo className="size-8" />
          <span className="text-sm font-semibold text-white">Convex Backup Console</span>
        </div>
        <div className="relative z-10 flex-1">
          <AuthVaultPanel stage={vaultStage} caption={vaultCaption} members={vaultMembers} />
        </div>
      </aside>

      <main className="flex min-h-svh flex-1 flex-col">
        <div className="bg-card flex items-center gap-2.5 border-b px-6 py-5 lg:hidden">
          <AppLogo className="size-8" />
          <span className="text-base font-semibold">Convex Backup Console</span>
        </div>
        <div className="bg-muted/30 flex flex-1 flex-col items-center justify-center gap-6 p-6 lg:bg-background">
          {top}
          <fieldset disabled={!hydrated} data-hydrated={hydrated} className={cn('m-0 w-full min-w-0 border-0 p-0', wide ? 'max-w-xl' : 'max-w-sm')}>
            {children}
          </fieldset>
        </div>
      </main>
    </div>
  )
}

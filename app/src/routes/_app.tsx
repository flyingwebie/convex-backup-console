import { useCallback, useEffect, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AppSidebar } from '~/components/app-sidebar'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import { isTheme } from '~/lib/themes'
import { startTour } from '~/lib/tour'
import { getAppContext, markTourSeen } from '~/server/fns'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const app = await getAppContext()
    if (!app) throw redirect({ to: '/login', search: { step: 'password', next: location.href } })
    if (!app.user.twoFactorEnabled) throw redirect({ to: '/security' })
    if (!app.user.sessionFactor) throw redirect({ to: '/verify', search: { next: location.href } })
    if (app.onboarding) throw redirect({ to: '/setup' })
    if (!app.active && !location.pathname.startsWith('/platform') && location.pathname !== '/account') {
      throw redirect({ to: '/no-workspace' })
    }
    return { app }
  },
  component: AppLayout,
})

function AppLayout() {
  const { app } = Route.useRouteContext()
  const theme = isTheme(app.settings?.theme) ? app.settings.theme : 'neutral'
  // On <html> (not a wrapper) so dialogs and popovers portalled to <body> pick it up too.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const seen = useServerFn(markTourSeen)
  const tourSeen = useRef(app.tourSeen)
  const tour = useCallback(() => {
    // Finishing or closing the tour (any way) stops it starting by itself again.
    void startTour({
      role: app.active?.role ?? null,
      platformAdmin: app.user.isPlatformAdmin,
      onFinish: () => {
        if (tourSeen.current) return
        tourSeen.current = true
        void seen()
      },
    })
  }, [app.active?.role, app.user.isPlatformAdmin, seen])
  // First visit: start once the shell has painted.
  useEffect(() => {
    if (tourSeen.current || !app.active) return
    const t = setTimeout(tour, 600)
    return () => clearTimeout(t)
  }, [])
  return (
    <SidebarProvider>
      {/* Applied before first paint on server-rendered loads, so the accent doesn't flash. */}
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(theme)}` }} />
      <AppSidebar app={app} onTour={() => setTimeout(tour, 150)} />
      <SidebarInset>
        {/* Remount pages when switching workspace so no state leaks across. */}
        <Outlet key={app.active?.id ?? 'none'} />
      </SidebarInset>
    </SidebarProvider>
  )
}

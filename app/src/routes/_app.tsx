import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AppSidebar } from '~/components/app-sidebar'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import { getAppContext } from '~/server/fns'

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
  return (
    <SidebarProvider>
      <AppSidebar app={app} />
      <SidebarInset>
        {/* Remount pages when switching workspace so no state leaks across. */}
        <Outlet key={app.active?.id ?? 'none'} />
      </SidebarInset>
    </SidebarProvider>
  )
}

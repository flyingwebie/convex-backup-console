import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AppSidebar } from '~/components/app-sidebar'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import { getUser } from '~/server/fns'

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login', search: { step: 'password' } })
    if (!user.twoFactorEnabled) throw redirect({ to: '/security' })
    return { user }
  },
  component: AppLayout,
})

function AppLayout() {
  const { user } = Route.useRouteContext()
  return (
    <SidebarProvider>
      <AppSidebar email={user.email} />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}

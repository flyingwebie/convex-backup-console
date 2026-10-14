import { Link, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  Bell,
  CalendarClock,
  Database,
  HardDrive,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Monitor,
  Moon,
  ScrollText,
  Settings,
  Sun,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { authClient } from '~/lib/auth-client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '~/components/ui/sidebar'

const nav = [
  {
    label: 'Backups',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/jobs', label: 'Jobs', icon: CalendarClock },
      { to: '/runs', label: 'Runs & restores', icon: Activity },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/instances', label: 'Instances', icon: Database },
      { to: '/destinations', label: 'Destinations', icon: HardDrive },
      { to: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
] as const

export function AppSidebar({ email }: { email: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { theme, setTheme } = useTheme()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <LifeBuoy className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Convex Backups</span>
                  <span className="text-muted-foreground truncate text-xs">Self-hosted console</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {nav.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.label}
                      isActive={item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)}
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <div className="bg-muted flex aspect-square size-8 items-center justify-center rounded-lg text-xs font-semibold uppercase">
                    {email.slice(0, 2)}
                  </div>
                  <span className="truncate text-sm">{email}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Theme</DropdownMenuLabel>
                {(
                  [
                    ['light', 'Light', Sun],
                    ['dark', 'Dark', Moon],
                    ['system', 'System', Monitor],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
                    <Icon /> {label} {theme === value && <span className="text-muted-foreground ml-auto text-xs">✓</span>}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings /> Account & security
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    await authClient.signOut()
                    window.location.href = '/login'
                  }}
                >
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

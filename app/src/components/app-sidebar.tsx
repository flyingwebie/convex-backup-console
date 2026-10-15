import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  Activity,
  Bell,
  CalendarClock,
  Check,
  ChevronsUpDown,
  Database,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Plus,
  ScrollText,
  PieChart,
  Server,
  Settings2,
  Sun,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { CreateWorkspaceDialog } from '~/components/create-workspace'
import { GitHubIcon } from '~/components/provider-icons'
import { WorkspaceLogo } from '~/components/workspace-logo'
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
import { authClient } from '~/lib/auth-client'
import { APP_VERSION, GIT_SHA, REPO_URL } from '~/lib/meta'
import { ROLE_INFO, can, type Action } from '~/lib/permissions'
import { switchWorkspace, type getAppContext } from '~/server/fns'

type App = NonNullable<Awaited<ReturnType<typeof getAppContext>>>
type Item = { to: string; label: string; icon: typeof Database; need?: Action }

const nav: { label: string; items: Item[] }[] = [
  {
    label: 'Backups',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/jobs', label: 'Jobs', icon: CalendarClock },
      { to: '/runs', label: 'Runs & restores', icon: Activity },
      { to: '/storage', label: 'Storage', icon: PieChart },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/instances', label: 'Instances', icon: Database },
      { to: '/destinations', label: 'Destinations', icon: HardDrive },
      { to: '/emails', label: 'Emails', icon: Mail },
      { to: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { to: '/workspace', label: 'Settings', icon: Settings2 },
      { to: '/members', label: 'Members', icon: Users },
      { to: '/trash', label: 'Trash', icon: Trash2 },
      { to: '/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
]

export function AppSidebar({ app }: { app: App }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const doSwitch = useServerFn(switchWorkspace)
  const [creating, setCreating] = useState(false)
  const active = app.active
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <WorkspaceLogo name={active?.name ?? '—'} logo={active?.logo} />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{active?.name ?? 'No workspace'}</span>
                    <span className="text-muted-foreground truncate text-xs">{active ? ROLE_INFO[active.role].label : 'Convex Backups'}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Workspaces</DropdownMenuLabel>
                {app.workspaces.map((w) => (
                  <DropdownMenuItem
                    key={w.id}
                    onClick={async () => {
                      if (w.id === active?.id) return
                      await doSwitch({ data: { id: w.id } })
                      await router.navigate({ to: '/' })
                      await router.invalidate()
                    }}
                  >
                    <WorkspaceLogo name={w.name} logo={w.logo} className="size-6 rounded-md text-[10px]" />
                    <span className="truncate">{w.name}</span>
                    {w.id === active?.id && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
                {app.user.isPlatformAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setCreating(true)}>
                      <Plus /> Create workspace
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {active &&
          nav.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items
                    .filter((i) => !i.need || can(active.role, i.need))
                    .map((item) => (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton asChild tooltip={item.label} isActive={isActive(item.to)}>
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
        {app.user.isPlatformAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Platform" isActive={isActive('/platform')}>
                    <Link to="/platform">
                      <Server />
                      <span>Workspaces & users</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <div className="bg-muted flex aspect-square size-8 items-center justify-center rounded-lg text-xs font-semibold uppercase">
                    {app.user.email.slice(0, 2)}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate">{app.user.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{app.user.email}</span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem asChild>
                  <Link to="/account">
                    <UserRound /> Account & security
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Theme</DropdownMenuLabel>
                {(
                  [
                    ['light', 'Light', Sun],
                    ['dark', 'Dark', Moon],
                    ['system', 'System', Monitor],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
                    <Icon /> {label} {theme === value && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
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
        <div className="text-muted-foreground flex items-center justify-between gap-2 px-2 pb-1 text-xs group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <a
            href={GIT_SHA ? `${REPO_URL}/commit/${GIT_SHA}` : `${REPO_URL}/releases`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground truncate font-mono tabular-nums group-data-[collapsible=icon]:hidden"
            title="Version"
          >
            v{APP_VERSION}
            {GIT_SHA && <span className="opacity-60"> · {GIT_SHA}</span>}
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Source code on GitHub"
            title="Source code on GitHub"
            className="hover:text-foreground hover:bg-sidebar-accent rounded-md p-1.5 transition-colors"
          >
            <GitHubIcon />
          </a>
        </div>
      </SidebarFooter>
      <SidebarRail />
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </Sidebar>
  )
}

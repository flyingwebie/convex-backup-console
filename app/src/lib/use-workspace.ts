import { useRouteContext } from '@tanstack/react-router'
import { can, type Action } from '~/lib/permissions'

/** Active workspace, role and settings from the app shell's context. */
export function useWorkspace() {
  const { app } = useRouteContext({ from: '/_app' })
  const role = app.active?.role ?? null
  return {
    user: app.user,
    workspace: app.active!,
    workspaces: app.workspaces,
    settings: app.settings!,
    role,
    can: (action: Action) => can(role, action),
  }
}

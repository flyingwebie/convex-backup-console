import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthShell } from '~/components/auth-shell'
import { CreateWorkspaceDialog } from '~/components/create-workspace'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { authClient } from '~/lib/auth-client'
import { getAppContext } from '~/server/fns'

export const Route = createFileRoute('/no-workspace')({
  beforeLoad: async () => {
    const app = await getAppContext()
    if (!app) throw redirect({ to: '/login', search: { step: 'password' } })
    if (app.active) throw redirect({ to: '/' })
    return { app }
  },
  component: NoWorkspace,
})

function NoWorkspace() {
  const { app } = Route.useRouteContext()
  const [open, setOpen] = useState(false)
  return (
    <AuthShell>
      <Card>
        <CardHeader className="text-center">
          <CardTitle>No workspace yet</CardTitle>
          <CardDescription>
            {app.user.isPlatformAdmin
              ? 'Create a workspace to start protecting Convex instances.'
              : "You're not a member of any workspace. Ask a workspace owner to invite you."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {app.user.isPlatformAdmin && <Button onClick={() => setOpen(true)}>Create workspace</Button>}
          <Button variant="outline" onClick={async () => { await authClient.signOut(); window.location.href = '/login' }}>Sign out</Button>
        </CardContent>
      </Card>
      <CreateWorkspaceDialog open={open} onClose={() => setOpen(false)} />
    </AuthShell>
  )
}

import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Mail, Pencil, Plus, RotateCcw, Send, ShieldCheck, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import { Confirm } from '~/components/confirm'
import { CreateWorkspaceDialog } from '~/components/create-workspace'
import { PageBody, PageHeader } from '~/components/page'
import { WorkspaceLogo } from '~/components/workspace-logo'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatDate, timeAgo } from '~/lib/format'
import { useAction } from '~/lib/use-action'
import { getPlatformEmails } from '~/server/email-fns'
import { getPlatform, purgeWorkspaceNow, resetUserSecondFactors, restoreWorkspaceFromTrash, saveSmtpSettings, setPlatformAdmin, testSmtp } from '~/server/fns'

export const Route = createFileRoute('/_app/platform')({
  beforeLoad: ({ context }) => {
    if (!context.app.user.isPlatformAdmin) throw redirect({ to: '/' })
  },
  loader: async () => ({ ...(await getPlatform()), emails: await getPlatformEmails() }),
  component: Platform,
})

function Platform() {
  const data = Route.useLoaderData()
  const { app } = Route.useRouteContext()
  const [creating, setCreating] = useState(false)
  const setAdmin = useServerFn(setPlatformAdmin)
  const reset2fa = useServerFn(resetUserSecondFactors)
  const restoreWs = useServerFn(restoreWorkspaceFromTrash)
  const purgeWs = useServerFn(purgeWorkspaceNow)
  const { run } = useAction()

  return (
    <>
      <PageHeader
        title="Platform"
        description="All workspaces and users on this console. Visible to platform admins only."
        actions={<Button onClick={() => setCreating(true)}><Plus /> Create workspace</Button>}
      />
      <PageBody>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Workspace</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Instances</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-56" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.workspaces.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2">
                      <WorkspaceLogo name={w.name} logo={w.logo} className="size-7 rounded-md text-[10px]" />
                      <div>
                        <div className="font-medium">{w.name}</div>
                        <div className="text-muted-foreground text-xs">{w.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{w.members}</TableCell>
                  <TableCell>{w.instances}</TableCell>
                  <TableCell>
                    {w.deleted_at ? (
                      <div>
                        <Badge variant="outline" className="border-red-500/30 text-red-600">Deleted</Badge>
                        <div className="text-muted-foreground mt-1 text-xs">purged {timeAgo(w.purge_at!)}</div>
                      </div>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {w.deleted_at && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => run(() => restoreWs({ data: { id: w.id } }), { success: `${w.name} restored` })}>
                          <RotateCcw /> Restore
                        </Button>
                        <Confirm
                          trigger={<Button size="sm" variant="ghost" className="text-destructive">Purge now</Button>}
                          title={`Permanently delete ${w.name}?`}
                          description="All its instances, jobs, destinations, alerts, runs and members are removed. Backup files follow the workspace's deletion policy."
                          action="Purge permanently"
                          onConfirm={() => run(() => purgeWs({ data: { id: w.id } }), { success: `${w.name} purged` })}
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Platform admins can create workspaces and see this page. Workspace access is managed in each workspace's Members.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>2FA</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Platform admin</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-muted-foreground text-xs">{u.email}</div>
                    </TableCell>
                    <TableCell>{u.two_factor ? <ShieldCheck className="size-4 text-emerald-600" /> : <ShieldOff className="size-4 text-amber-600" />}</TableCell>
                    <TableCell>{u.workspaces}</TableCell>
                    <TableCell className="text-sm">{formatDate(new Date(u.created_at).getTime())}</TableCell>
                    <TableCell>
                      <Switch
                        checked={u.isAdmin}
                        disabled={u.id === app.user.id}
                        aria-label="Platform admin"
                        onCheckedChange={(admin) => run(() => setAdmin({ data: { userId: u.id, admin } }), { success: admin ? `${u.email} is now a platform admin` : `${u.email} is no longer a platform admin` })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {u.id !== app.user.id && u.two_factor && (
                        <Confirm
                          trigger={<Button size="sm" variant="ghost">Reset 2FA</Button>}
                          title={`Reset ${u.email}'s second factors?`}
                          description="Removes their authenticator app and passkeys and signs them out everywhere. They'll set up a new factor at next sign-in. Only do this after confirming their identity."
                          action="Reset 2FA"
                          onConfirm={() => run(() => reset2fa({ data: { userId: u.id } }), { success: `${u.email} must set up 2FA again` })}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <SmtpCard smtp={data.smtp} />
        <DefaultTemplatesCard types={data.emails.types} />
      </PageBody>
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

function DefaultTemplatesCard({ types }: { types: Awaited<ReturnType<typeof getPlatformEmails>>['types'] }) {
  return (
    <Card className="gap-0">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2"><Mail className="size-4" /> Default email templates</CardTitle>
        <CardDescription>What every workspace sends unless it has its own version. Workspace owners and admins can customise theirs on the Emails page.</CardDescription>
      </CardHeader>
      <ul className="divide-y">
        {types.map((t) => (
          <li key={t.type} className="flex items-center gap-3 px-6 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {t.label}
                {t.source === 'platform' && <Badge variant="secondary">Edited</Badge>}
              </div>
              <div className="text-muted-foreground truncate text-xs">{t.group} · {t.description}</div>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/emails/$type" params={{ type: t.type }} search={{ scope: 'platform' }}><Pencil /> Edit</Link>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function SmtpCard({ smtp }: { smtp: Awaited<ReturnType<typeof getPlatform>>['smtp'] }) {
  const save = useServerFn(saveSmtpSettings)
  const test = useServerFn(testSmtp)
  const { run, pending } = useAction()
  const [secure, setSecure] = useState(smtp?.secure ?? false)
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
          void run(
            () => save({ data: { host: f.host, port: Number(f.port), secure, user: f.user || undefined, pass: f.pass || undefined, from: f.from } }),
            { success: 'SMTP saved' },
          )
        }}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="size-4" /> Email (SMTP)</CardTitle>
          <CardDescription>Sends invitations, alerts, digests and security emails for every workspace (unless a workspace sets its own). Without it, you copy invitation links manually.</CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
              <Field>
                <FieldLabel htmlFor="s-host">Host</FieldLabel>
                <Input id="s-host" name="host" defaultValue={smtp?.host} required placeholder="smtp.postmarkapp.com" />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-port">Port</FieldLabel>
                <Input id="s-port" name="port" type="number" defaultValue={smtp?.port ?? 587} required />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="s-user">Username</FieldLabel>
                <Input id="s-user" name="user" defaultValue={smtp?.user} autoComplete="off" />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-pass">Password</FieldLabel>
                <Input id="s-pass" name="pass" type="password" defaultValue={smtp?.pass} autoComplete="off" />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-from">From</FieldLabel>
                <Input id="s-from" name="from" defaultValue={smtp?.from} required placeholder="Backups <backups@example.com>" />
              </Field>
            </div>
            <Field orientation="horizontal">
              <Checkbox id="s-secure" checked={secure} onCheckedChange={(v) => setSecure(v === true)} />
              <FieldLabel htmlFor="s-secure" className="font-normal">Use TLS from the start (port 465)</FieldLabel>
            </Field>
            <FieldDescription>Credentials are stored encrypted with the master key.</FieldDescription>
          </FieldGroup>
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="submit" disabled={pending}>Save</Button>
          {smtp && (
            <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => test(), { success: 'Test email sent to you' })}>
                <Send /> Send test email
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => save({ data: null }), { success: 'SMTP removed' })}>
                Remove
              </Button>
            </>
          )}
        </CardFooter>
      </form>
    </Card>
  )
}

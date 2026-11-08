import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Clock, Copy, Crown, Eye, Link2, Mail, PlayCircle, Shield, ShieldCheck, ShieldOff, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Confirm } from '~/components/confirm'
import { PageBody, PageHeader } from '~/components/page'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { timeAgo } from '~/lib/format'
import { ROLES, ROLE_INFO, type Role } from '~/lib/permissions'
import { useAction } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { cancelInvite, changeMemberRole, getMembers, inviteMember, removeMember } from '~/server/fns'

const ROLE_ICON: Record<Role, typeof Crown> = { owner: Crown, admin: Shield, operator: PlayCircle, viewer: Eye }

export const Route = createFileRoute('/_app/members')({
  loader: () => getMembers(),
  component: Members,
})

const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success('Invitation link copied'))

function Members() {
  const data = Route.useLoaderData()
  const { can, workspace } = useWorkspace()
  const manage = can('members')
  const [inviting, setInviting] = useState(false)
  const setRole = useServerFn(changeMemberRole)
  const remove = useServerFn(removeMember)
  const cancel = useServerFn(cancelInvite)
  const { run } = useAction()

  return (
    <>
      <PageHeader
        title="Members"
        description={`People with access to ${workspace.name}.`}
        actions={manage && <Button onClick={() => setInviting(true)}><UserPlus /> Invite member</Button>}
      />
      <PageBody>
        <Card className="py-0">
          <CardHeader className="flex-row items-center gap-3 border-b py-4">
            <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
              <Users className="text-muted-foreground size-4" />
            </span>
            <div className="flex-1">
              <CardTitle>Members</CardTitle>
              <CardDescription>Change a role inline. Every workspace keeps at least one owner.</CardDescription>
            </div>
            <span className="text-muted-foreground font-mono text-xs">{data.members.length} members</span>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Member</TableHead>
                <TableHead>2FA</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-52">Role</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <span className="bg-muted flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold uppercase">
                        {(m.name || m.email).slice(0, 2)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{m.name} {m.you && <span className="text-muted-foreground text-xs">(you)</span>}</div>
                        <div className="text-muted-foreground truncate text-xs">{m.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.two_factor ? (
                      <span className="text-success inline-flex items-center gap-1.5 text-xs">
                        <ShieldCheck className="size-4" aria-hidden /> Enabled
                      </span>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-warning inline-flex items-center gap-1.5 text-xs">
                            <ShieldOff className="size-4" aria-hidden /> Not enrolled
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Hasn't finished 2FA enrolment — can't access anything yet</TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{timeAgo(new Date(m.created_at).getTime())}</TableCell>
                  <TableCell>
                    {manage ? (
                      <Select value={m.role} onValueChange={(role) => run(() => setRole({ data: { memberId: m.id, role: role as Role } }), { success: `${m.email} is now ${ROLE_INFO[role as Role].label}` })}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_INFO[r].label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{ROLE_INFO[m.role as Role]?.label ?? m.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {manage && !m.you && (
                      <Confirm
                        trigger={<Button variant="ghost" size="icon" aria-label="Remove"><Trash2 /></Button>}
                        title={`Remove ${m.email}?`}
                        description="They lose access to this workspace immediately. Their account and other workspaces are unaffected."
                        action="Remove"
                        onConfirm={() => run(() => remove({ data: { memberId: m.id } }), { success: 'Member removed' })}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        {manage && data.invitations.length > 0 && (
          <Card className="py-0">
            <CardHeader className="flex-row items-center gap-3 border-b py-4">
              <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
                <Mail className="text-muted-foreground size-4" />
              </span>
              <div className="flex-1">
                <CardTitle>Pending invitations</CardTitle>
                <CardDescription>Not yet accepted. Invite links expire after 7 days.</CardDescription>
              </div>
              <span className="text-muted-foreground font-mono text-xs">{data.invitations.length} pending</span>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 py-4">
              {data.invitations.map((i) => (
                <div
                  key={i.id}
                  className="border-border bg-muted/30 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-dashed px-3 py-2.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                      <Mail className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{i.email}</div>
                      <div className="text-muted-foreground truncate text-xs">Invitation pending</div>
                    </div>
                  </div>
                  <Badge variant="outline">{ROLE_INFO[i.role as Role]?.label ?? i.role}</Badge>
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs whitespace-nowrap">
                    <Clock className="size-3.5" />
                    {i.expired ? <span className="text-destructive">Expired</span> : `Expires ${timeAgo(new Date(i.expires_at).getTime())}`}
                  </span>
                  <div className="ml-auto flex gap-1">
                    {!i.expired && <Button size="sm" variant="outline" onClick={() => copy(i.link)}><Copy /> Copy link</Button>}
                    <Button size="icon" variant="ghost" aria-label="Cancel invitation" onClick={() => run(() => cancel({ data: { id: i.id } }), { success: 'Invitation cancelled' })}>
                      <X />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="py-0">
          <CardHeader className="flex-row items-center gap-3 border-b py-4">
            <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
              <Shield className="text-muted-foreground size-4" />
            </span>
            <div>
              <CardTitle>Roles</CardTitle>
              <CardDescription>What each role can do in {workspace.name}.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 py-4 sm:grid-cols-2">
            {ROLES.map((r) => {
              const Icon = ROLE_ICON[r]
              const count = data.members.filter((m) => m.role === r).length
              return (
                <div key={r} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Icon className="text-muted-foreground size-3.5" /> {ROLE_INFO[r].label}
                    </div>
                    <span className="text-muted-foreground font-mono text-xs">{count} member{count === 1 ? '' : 's'}</span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">{ROLE_INFO[r].description}</p>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </PageBody>
      {inviting && <InviteDialog smtp={data.smtp} onClose={() => setInviting(false)} />}
    </>
  )
}

function InviteDialog({ smtp, onClose }: { smtp: boolean; onClose: () => void }) {
  const invite = useServerFn(inviteMember)
  const { run, pending } = useAction()
  const [role, setRole] = useState<Role>('admin')
  const [result, setResult] = useState<{ link: string; emailed: boolean; email: string } | null>(null)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation created</DialogTitle>
              <DialogDescription>
                {result.emailed ? `We emailed ${result.email}. You can also share the link yourself:` : `Send this link to ${result.email} (email isn't configured):`}
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted my-4 flex items-center gap-2 rounded-md p-2">
              <Link2 className="text-muted-foreground size-4 shrink-0" />
              <code className="truncate text-xs">{result.link}</code>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => copy(result.link)}><Copy /> Copy link</Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const email = String(new FormData(e.currentTarget).get('email'))
              const r = await run(() => invite({ data: { email, role } }))
              if (r) setResult({ ...r, email })
            }}
          >
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>They set a password and enrol 2FA when accepting.</DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-6">
              <Field>
                <FieldLabel htmlFor="inv-email">Email</FieldLabel>
                <Input id="inv-email" name="email" type="email" required autoFocus />
              </Field>
              <Field>
                <FieldLabel>Role</FieldLabel>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_INFO[r].label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FieldDescription>{ROLE_INFO[role].description}</FieldDescription>
              </Field>
              {!smtp && (
                <Alert>
                  <Mail />
                  <AlertTitle>Email isn't configured</AlertTitle>
                  <AlertDescription>You'll get a link to send yourself. A platform admin can set up SMTP.</AlertDescription>
                </Alert>
              )}
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={pending}>Create invitation</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

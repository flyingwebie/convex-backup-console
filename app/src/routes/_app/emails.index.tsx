import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Code2, Mail, Palette, Pencil, Plus, Send, Server, Users, X } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { PageBody, PageHeader } from '~/components/page'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'
import { timeAgo } from '~/lib/format'
import { ROLE_INFO, ROLES, type Role } from '~/lib/permissions'
import { useAction } from '~/lib/use-action'
import { getEmails, saveEmailBranding, saveEmailRoute, saveWorkspaceSmtp, testWorkspaceSmtp } from '~/server/email-fns'

export const Route = createFileRoute('/_app/emails/')({
  validateSearch: z.object({ tab: z.enum(['templates', 'recipients', 'branding']).optional() }),
  loader: () => getEmails(),
  component: Emails,
})

type Data = Awaited<ReturnType<typeof getEmails>>
type TypeRow = Data['types'][number]
type RouteData = NonNullable<TypeRow['route']>

const DEFAULT_ACCENT = '#4f46e5'

function Emails() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/emails/' })
  const tab = search.tab ?? 'templates'
  return (
    <>
      <PageHeader title="Emails" description="Branded emails for your team and clients — edit the templates, choose who receives each one, and set how they're sent." />
      <PageBody>
        {!data.smtp.platform && !data.smtp.hasOwn && (
          <Card className="flex-row items-center gap-3 border-amber-500/40 bg-amber-500/5 px-4 py-3">
            <Server className="size-4 shrink-0 text-amber-600" />
            <p className="flex-1 text-sm">
              No SMTP server yet, so nothing is sent. A platform admin can set one up under Platform, or {data.canAdvanced ? 'you can add this workspace’s own under Branding & sending' : 'a workspace owner can add one for this workspace'}.
            </p>
          </Card>
        )}
        <Tabs value={tab} onValueChange={(t) => navigate({ search: { tab: t as typeof tab } })}>
          <TabsList>
            <TabsTrigger value="templates"><Mail /> Templates</TabsTrigger>
            {data.canManage && <TabsTrigger value="recipients"><Users /> Recipients</TabsTrigger>}
            {data.canManage && <TabsTrigger value="branding"><Palette /> Branding & sending</TabsTrigger>}
          </TabsList>
          <TabsContent value="templates" className="mt-4"><Templates data={data} /></TabsContent>
          {data.canManage && <TabsContent value="recipients" className="mt-4"><Recipients data={data} /></TabsContent>}
          {data.canManage && <TabsContent value="branding" className="mt-4 space-y-6"><BrandingCard data={data} /><SmtpCard data={data} /></TabsContent>}
        </Tabs>
      </PageBody>
    </>
  )
}

const GROUPS = ['Backups', 'Restores', 'Reports', 'Team & access'] as const

function sourceBadge(t: TypeRow) {
  if (t.source === 'workspace') return <Badge>{t.mode === 'html' ? <><Code2 className="size-3" /> Custom HTML</> : 'Customised'}</Badge>
  return <Badge variant="secondary">{t.source === 'platform' ? 'Platform default' : 'Default'}</Badge>
}

function recipientSummary(r: RouteData | null, direct: boolean) {
  if (!r) return null
  if (!r.enabled) return 'Off'
  if (direct) return 'Sent to the person concerned'
  const parts = [
    ...r.roles.map((role) => `${ROLE_INFO[role as Role].label}s`),
    ...(r.actor ? ['who did it'] : []),
    ...(r.members.length ? [`${r.members.length} member${r.members.length > 1 ? 's' : ''}`] : []),
    ...(r.externals.length ? [`${r.externals.length} external`] : []),
  ]
  return parts.length ? parts.join(', ') : 'Nobody'
}

function Templates({ data }: { data: Data }) {
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => (
        <Card key={g} className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">{g}</CardTitle>
          </CardHeader>
          <ul className="divide-y">
            {data.types
              .filter((t) => t.group === g)
              .map((t) => (
                <li key={t.type} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.label}</span>
                      {sourceBadge(t)}
                      {t.route && !t.route.enabled && <Badge variant="outline">Off</Badge>}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-sm">{t.description}</p>
                    {t.route && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        To: {recipientSummary(t.route, t.direct)}
                        {t.route.count != null && t.route.enabled && ` · ${t.route.count} recipient${t.route.count === 1 ? '' : 's'} now`}
                        {t.updated_at && ` · edited ${timeAgo(t.updated_at)} by ${t.updated_by}`}
                      </p>
                    )}
                  </div>
                  {data.canManage && (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/emails/$type" params={{ type: t.type }} search={{}}>
                        <Pencil /> Edit
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

function Recipients({ data }: { data: Data }) {
  const save = useServerFn(saveEmailRoute)
  const { run } = useAction()
  const [editing, setEditing] = useState<TypeRow | null>(null)
  const update = (t: TypeRow, patch: Partial<RouteData>) => {
    const r = { ...t.route!, ...patch }
    return run(() => save({ data: { type: t.type, enabled: r.enabled, roles: r.roles as Role[], members: r.members, externals: r.externals, actor: r.actor } }))
  }
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Email</TableHead>
            {ROLES.map((r) => <TableHead key={r} className="text-center">{ROLE_INFO[r].label}s</TableHead>)}
            <TableHead className="text-center">Who did it</TableHead>
            <TableHead>Also send to</TableHead>
            <TableHead className="pr-4 text-right">On</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.types.map((t) => {
            const r = t.route!
            return (
              <TableRow key={t.type} className={r.enabled ? '' : 'opacity-60'}>
                <TableCell className="pl-4">
                  <div className="font-medium">{t.label}</div>
                  <div className="text-muted-foreground text-xs">{t.group}{r.count != null && r.enabled ? ` · ${r.count} recipient${r.count === 1 ? '' : 's'}` : ''}</div>
                </TableCell>
                {t.direct ? (
                  <TableCell colSpan={6} className="text-muted-foreground text-sm">Always sent to the person concerned (the invitee or the member).</TableCell>
                ) : (
                  <>
                    {ROLES.map((role) => (
                      <TableCell key={role} className="text-center">
                        <Checkbox
                          aria-label={`${t.label}: ${ROLE_INFO[role].label}s`}
                          checked={r.roles.includes(role)}
                          disabled={!r.enabled}
                          onCheckedChange={(v) => update(t, { roles: v ? [...r.roles, role] : r.roles.filter((x) => x !== role) })}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-center">
                      {t.hasActor ? (
                        <Checkbox aria-label={`${t.label}: who did it`} checked={r.actor} disabled={!r.enabled} onCheckedChange={(v) => update(t, { actor: v === true })} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-auto max-w-56 justify-start px-2 py-1 text-left font-normal" disabled={!r.enabled} onClick={() => setEditing(t)}>
                        {r.members.length + r.externals.length === 0 ? (
                          <span className="text-muted-foreground"><Plus className="inline size-3" /> Add</span>
                        ) : (
                          <span className="truncate">
                            {[...r.members.map((id) => data.members.find((m) => m.id === id)?.email ?? 'removed member'), ...r.externals].join(', ')}
                          </span>
                        )}
                      </Button>
                    </TableCell>
                  </>
                )}
                <TableCell className="pr-4 text-right">
                  <Switch aria-label={`${t.label} enabled`} checked={r.enabled} onCheckedChange={(v) => update(t, { enabled: v })} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="text-muted-foreground border-t px-4 py-3 text-xs">
        Members can turn off emails they receive under Account → Email preferences. Security emails (password, passkeys, 2FA resets) are always sent.
      </p>
      {editing && <ExtraRecipients data={data} t={editing} onClose={() => setEditing(null)} onSave={(patch) => update(editing, patch)} />}
    </Card>
  )
}

function ExtraRecipients({ data, t, onClose, onSave }: { data: Data; t: TypeRow; onClose: () => void; onSave: (p: Partial<RouteData>) => Promise<unknown> }) {
  const [members, setMembers] = useState<string[]>(t.route!.members)
  const [externals, setExternals] = useState<string[]>(t.route!.externals)
  const [draft, setDraft] = useState('')
  const addDraft = () => {
    const emails = draft.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    if (emails.length) setExternals((x) => [...new Set([...x, ...emails])])
    setDraft('')
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.label}: also send to</DialogTitle>
          <DialogDescription>Specific members (whatever their role) and addresses outside the workspace, such as a client or a shared inbox.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-2">
          <Field>
            <FieldLabel>Members</FieldLabel>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
              {data.members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={members.includes(m.id)} onCheckedChange={(v) => setMembers((x) => (v ? [...x, m.id] : x.filter((id) => id !== m.id)))} />
                  <span className="truncate">{m.name || m.email}</span>
                  <span className="text-muted-foreground truncate text-xs">{m.email} · {ROLE_INFO[m.role as Role]?.label}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="ext">External addresses</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="ext"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addDraft()
                  }
                }}
                placeholder="client@example.com"
              />
              <Button type="button" variant="outline" onClick={addDraft}>Add</Button>
            </div>
            {externals.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {externals.map((e) => (
                  <Badge key={e} variant="secondary" className="gap-1 pr-1">
                    {e}
                    <button type="button" aria-label={`Remove ${e}`} className="hover:bg-muted rounded p-0.5" onClick={() => setExternals((x) => x.filter((y) => y !== e))}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <FieldDescription>External recipients can't opt out themselves — remove them here.</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              const pending = draft.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
              const ok = await onSave({ members, externals: [...new Set([...externals, ...pending])] })
              if (ok !== undefined) onClose()
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BrandingCard({ data }: { data: Data }) {
  const save = useServerFn(saveEmailBranding)
  const test = useServerFn(testWorkspaceSmtp)
  const { run, pending } = useAction()
  const b = data.branding
  const [accent, setAccent] = useState(b.accent ?? DEFAULT_ACCENT)
  const [hide, setHide] = useState(b.hidePoweredBy)
  const canSend = data.smtp.platform || data.smtp.hasOwn
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
          void run(
            () => save({ data: { accent: accent.toLowerCase() === DEFAULT_ACCENT ? null : accent, footer: f.footer, supportEmail: f.supportEmail, hidePoweredBy: hide, senderName: f.senderName, replyTo: f.replyTo } }),
            { success: 'Branding saved' },
          )
        }}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Palette className="size-4" /> Branding</CardTitle>
          <CardDescription>Every email uses the workspace logo and name (from Settings), plus these.</CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="accent">Accent colour</FieldLabel>
                <div className="flex gap-2">
                  <input type="color" aria-label="Pick accent colour" value={accent} onChange={(e) => setAccent(e.target.value)} className="border-input h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1" />
                  <Input id="accent" value={accent} onChange={(e) => setAccent(e.target.value)} className="font-mono" pattern="#[0-9a-fA-F]{6}" />
                </div>
                <FieldDescription>Buttons and the top border.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="supportEmail">Support email</FieldLabel>
                <Input id="supportEmail" name="supportEmail" type="email" defaultValue={b.supportEmail} placeholder="support@example.com" />
                <FieldDescription>Shown in the footer as “Questions?”.</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="footer">Footer text</FieldLabel>
              <Textarea id="footer" name="footer" rows={2} defaultValue={b.footer} placeholder="Acme Agency Ltd · 1 Grand Canal Quay, Dublin" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="senderName">Sender name</FieldLabel>
                <Input id="senderName" name="senderName" defaultValue={b.senderName} placeholder={data.branding.senderName || 'e.g. Acme Backups'} />
                <FieldDescription>The address stays {data.smtp.hasOwn ? 'your SMTP’s' : (data.smtp.platformFrom ?? 'the platform’s')}.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="replyTo">Reply-to</FieldLabel>
                <Input id="replyTo" name="replyTo" type="email" defaultValue={b.replyTo} placeholder="ops@example.com" />
              </Field>
            </div>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="hide">Hide “Sent by Convex Backup Console”</FieldLabel>
                <FieldDescription>Removes the small credit line under every email.</FieldDescription>
              </FieldContent>
              <Switch id="hide" checked={hide} onCheckedChange={setHide} />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="gap-2 border-t">
          <Button type="submit" disabled={pending}>Save branding</Button>
          <Button type="button" variant="outline" disabled={pending || !canSend} onClick={() => run(() => test(), { success: (r) => `Test sent to ${r.to}` })}>
            <Send /> Send test to me
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function SmtpCard({ data }: { data: Data }) {
  const save = useServerFn(saveWorkspaceSmtp)
  const { run, pending } = useAction()
  const own = data.smtp.own
  const [editing, setEditing] = useState(false)
  const [secure, setSecure] = useState(own?.secure ?? false)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Server className="size-4" /> Sending server</CardTitle>
        <CardDescription>
          {data.smtp.hasOwn
            ? 'This workspace sends through its own SMTP server.'
            : data.smtp.platform
              ? `This workspace uses the platform’s SMTP server (${data.smtp.platformFrom}).`
              : 'No SMTP server is configured.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="py-2">
        {!data.canAdvanced ? (
          <p className="text-muted-foreground text-sm">Only workspace owners can change the sending server, because it holds credentials.</p>
        ) : editing ? (
          <form
            id="smtp-form"
            onSubmit={async (e) => {
              e.preventDefault()
              const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
              const ok = await run(() => save({ data: { host: f.host, port: Number(f.port), secure, user: f.user || undefined, pass: f.pass || undefined, from: f.from } }), { success: 'Sending server saved' })
              if (ok !== undefined) setEditing(false)
            }}
          >
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
                <Field><FieldLabel htmlFor="host">SMTP host</FieldLabel><Input id="host" name="host" required defaultValue={own?.host} placeholder="smtp.postmarkapp.com" /></Field>
                <Field><FieldLabel htmlFor="port">Port</FieldLabel><Input id="port" name="port" type="number" required defaultValue={own?.port ?? 587} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field><FieldLabel htmlFor="user">Username</FieldLabel><Input id="user" name="user" autoComplete="off" defaultValue={own?.user} /></Field>
                <Field><FieldLabel htmlFor="pass">Password</FieldLabel><Input id="pass" name="pass" type="password" autoComplete="new-password" defaultValue={own?.pass} /></Field>
              </div>
              <Field><FieldLabel htmlFor="from">From address</FieldLabel><Input id="from" name="from" required defaultValue={own?.from} placeholder="Acme Backups <backups@acme.dev>" /></Field>
              <Field orientation="horizontal">
                <Checkbox id="secure" checked={secure} onCheckedChange={(v) => setSecure(v === true)} />
                <FieldLabel htmlFor="secure" className="font-normal">Use TLS from the start (port 465)</FieldLabel>
              </Field>
            </FieldGroup>
          </form>
        ) : (
          own && <p className="font-mono text-sm">{own.host}:{own.port} · {own.from}</p>
        )}
      </CardContent>
      {data.canAdvanced && (
        <CardFooter className="gap-2 border-t">
          {editing ? (
            <>
              <Button type="submit" form="smtp-form" disabled={pending}>Save server</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>{own ? 'Edit' : 'Use this workspace’s own SMTP'}</Button>
              {own && (
                <Button variant="ghost" disabled={pending} onClick={() => run(() => save({ data: null }), { success: data.smtp.platform ? 'Back to the platform server' : 'Sending server removed' })}>
                  Remove
                </Button>
              )}
            </>
          )}
        </CardFooter>
      )}
    </Card>
  )
}

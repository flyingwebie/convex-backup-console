import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Cloud, Database, Info, MoreHorizontal, Pencil, Plus, PlugZap, Server, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { Confirm } from '~/components/confirm'
import { InstanceKindBadge } from '~/components/instance-kind'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { PageBody, PageHeader } from '~/components/page'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { timeAgo } from '~/lib/format'
import { useAction, usePolling } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { cn } from '~/lib/utils'
import type { Action } from '~/lib/permissions'
import { EntityChip, entityHref, type DotStatus, StatusDot } from '~/components/viz'
import { useFocusRow } from '~/hooks/use-focus-row'
import { addInstance, deleteInstance, getInstances, testInstance, updateInstance } from '~/server/fns'

/** Maps an instance's live/last-run state to the semantic Status Dot vocabulary (DESIGN.md §5.3) —
 * dot + plain word, instead of a solid-fill badge, so Instances reads consistently with Jobs/Runs. */
function instanceStatus(i: { busy: boolean; restoring: boolean; last_status: string | null }): { status: DotStatus; label: string } {
  if (i.busy) return { status: 'running', label: 'Backing up' }
  if (i.restoring) return { status: 'running', label: 'Restoring' }
  switch (i.last_status) {
    case 'ok':
      return { status: 'success', label: 'Ok' }
    case 'partial':
      return { status: 'warning', label: 'Partial' }
    case 'failed':
      return { status: 'danger', label: 'Failed' }
    default:
      return { status: 'neutral', label: '—' }
  }
}

export const Route = createFileRoute('/_app/instances')({
  // `?focus=<id>` (from the ⌘K palette's "Jump to" results, via entityHref) scrolls that instance's
  // row into view and flashes it — see useFocusRow.
  validateSearch: z.object({ focus: z.string().optional() }),
  loader: () => getInstances(),
  component: Instances,
})

type Instance = Awaited<ReturnType<typeof getInstances>>['instances'][number]
type Job = Awaited<ReturnType<typeof getInstances>>['jobs'][number]

function Instances() {
  const { instances, jobs } = Route.useLoaderData()
  const { focus } = Route.useSearch()
  const [editing, setEditing] = useState<Instance | 'new' | null>(null)
  const test = useServerFn(testInstance)
  const del = useServerFn(deleteInstance)
  const { run } = useAction()
  const { can: allowed } = useWorkspace()
  usePolling(instances.some((i) => i.busy || i.restoring))

  return (
    <>
      <PageHeader
        title="Instances"
        description="Self-hosted Convex deployments this console backs up and restores."
        actions={allowed('manage') && <Button onClick={() => setEditing('new')}><Plus /> Add instance</Button>}
      />
      <PageBody>
        {instances.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Database /></EmptyMedia>
              <EmptyTitle>No instances yet</EmptyTitle>
              <EmptyDescription>Connect a self-hosted Convex instance (URL + admin key) or a Convex Cloud deployment (deploy key).</EmptyDescription>
            </EmptyHeader>
            {allowed('manage') && <EmptyContent><Button onClick={() => setEditing('new')}><Plus /> Add instance</Button></EmptyContent>}
          </Empty>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>API URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last good backup</TableHead>
                  <TableHead>Jobs</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((i) => (
                  <InstanceRow
                    key={i.id}
                    i={i}
                    instanceJobs={jobs.filter((j) => j.instance_id === i.id)}
                    focus={focus}
                    allowed={allowed}
                    run={run}
                    test={test}
                    del={del}
                    onEdit={() => setEditing(i)}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </PageBody>
      {editing && <InstanceDialog instance={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/** One row of the instances table, split out so `useFocusRow` (called here, not inside the `.map()`
 * in `Instances`) keeps a stable hook-call count across renders even as the instance list's length
 * changes. */
function InstanceRow({
  i,
  instanceJobs,
  focus,
  allowed,
  run,
  test,
  del,
  onEdit,
}: {
  i: Instance
  instanceJobs: Job[]
  focus: string | undefined
  allowed: (action: Action) => boolean
  run: ReturnType<typeof useAction>['run']
  test: ReturnType<typeof useServerFn<typeof testInstance>>
  del: ReturnType<typeof useServerFn<typeof deleteInstance>>
  onEdit: () => void
}) {
  const { status, label } = instanceStatus(i)
  const { ref, highlight } = useFocusRow<HTMLTableRowElement>(i.id, focus)
  return (
    <TableRow ref={ref} className={cn(highlight && 'bg-primary/10 ring-2 ring-inset ring-primary/50 transition-colors duration-700')}>
      <TableCell className="pl-4">
        <div className="font-medium">{i.name}</div>
        {i.deployment_name && <div className="text-muted-foreground font-mono text-xs">{i.deployment_name}</div>}
      </TableCell>
      <TableCell><InstanceKindBadge kind={i.kind} type={i.deployment_type} /></TableCell>
      <TableCell className="text-muted-foreground max-w-[260px] truncate font-mono text-xs" title={i.url}>
        {i.url}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-sm">
          <StatusDot status={status} />
          {label}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">{timeAgo(i.last_ok_at)}</TableCell>
      <TableCell>
        {instanceJobs.length === 0 ? (
          <span className="text-muted-foreground text-sm">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {instanceJobs.map((j) => (
              <EntityChip key={j.id} kind="job" name={j.name} {...entityHref('job', j.id)} size="sm" />
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        {allowed('run') && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Actions"><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => run(() => test({ data: { id: i.id } }), { success: (r) => `${i.name} is reachable (Convex ${r.version})` })}>
              <PlugZap /> Test connection
            </DropdownMenuItem>
            {allowed('manage') && (
              <>
                <DropdownMenuItem onClick={onEdit}><Pencil /> Edit</DropdownMenuItem>
                <DropdownMenuSeparator />
                <Confirm
                  trigger={<DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}><Trash2 /> Move to trash</DropdownMenuItem>}
                  title={`Delete ${i.name}?`}
                  description={`The instance and its ${instanceJobs.length} job${instanceJobs.length === 1 ? '' : 's'} move to the Trash and can be restored until the workspace's grace period ends.`}
                  action="Move to trash"
                  onConfirm={() => run(() => del({ data: { id: i.id } }), { success: `${i.name} moved to trash` })}
                />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  )
}

function InstanceDialog({ instance, onClose }: { instance: Instance | 'new' | null; onClose: () => void }) {
  const existing = instance && instance !== 'new' ? instance : null
  const [kind, setKind] = useState<'self_hosted' | 'cloud'>(existing?.kind ?? 'self_hosted')
  return (
    <Dialog open={instance !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {instance !== null && (
          <InstanceForm key={existing?.id ?? 'new'} existing={existing} kind={existing?.kind ?? kind} setKind={existing ? undefined : setKind} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function InstanceForm({
  existing,
  kind,
  setKind,
  onClose,
}: {
  existing: Instance | null
  kind: 'self_hosted' | 'cloud'
  setKind?: (k: 'self_hosted' | 'cloud') => void
  onClose: () => void
}) {
  const add = useServerFn(addInstance)
  const update = useServerFn(updateInstance)
  const { run, pending } = useAction()
  const cloud = kind === 'cloud'

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
        const ok = existing
          ? await run(() => update({ data: { id: existing.id, name: f.name, url: f.url || undefined, key: f.key || undefined } }), {
              success: (r) => `Saved — Convex ${r.version}`,
            })
          : await run(
              () =>
                add({
                  data: cloud
                    ? { kind: 'cloud', name: f.name, deployKey: f.key, url: f.url || undefined }
                    : { kind: 'self_hosted', name: f.name, url: f.url, adminKey: f.key },
                }),
              { success: (r) => `Connected to ${r.url} (Convex ${r.version})` },
            )
        if (ok) onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{existing ? `Edit ${existing.name}` : 'Add instance'}</DialogTitle>
        <DialogDescription>The connection and key are verified before saving. Keys are stored encrypted.</DialogDescription>
      </DialogHeader>
      {setKind && (
        <Tabs value={kind} onValueChange={(v) => setKind(v as 'self_hosted' | 'cloud')} className="pt-4">
          <TabsList className="w-full">
            <TabsTrigger value="self_hosted"><Server /> Self-hosted</TabsTrigger>
            <TabsTrigger value="cloud"><Cloud /> Convex Cloud</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <FieldGroup className="py-6">
        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input id="name" name="name" defaultValue={existing?.name} placeholder={cloud ? 'acme-prod-cloud' : 'acme-prod'} required />
          <FieldDescription>Used in backup file paths, e.g. <code>acme-prod/2026-10-14T03-00-00Z.zip</code>.</FieldDescription>
        </Field>
        {cloud ? (
          <>
            <Field>
              <FieldLabel htmlFor="key">Deploy key</FieldLabel>
              <Input
                id="key"
                name="key"
                type="password"
                autoComplete="off"
                placeholder={existing ? 'Leave empty to keep the current key' : 'prod:happy-otter-123|eyJ2…'}
                required={!existing}
              />
              <FieldDescription>
                Convex dashboard → your project → pick the deployment (Production or Development) → <strong>Settings</strong> →{' '}
                <strong>Generate Production Deploy Key</strong> (or Development). Use a key for one deployment — not a project or preview key.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="url">Deployment URL <span className="text-muted-foreground font-normal">(optional)</span></FieldLabel>
              <Input id="url" name="url" type="url" placeholder={existing?.url ?? 'Looked up automatically from the key'} />
              <FieldDescription>Only needed for a custom domain. Otherwise Convex tells us the URL.</FieldDescription>
            </Field>
            {!existing && (
              <Alert>
                <Info />
                <AlertTitle>A deploy key is full admin access to that deployment</AlertTitle>
                <AlertDescription>
                  Anyone holding it can read and overwrite data. It's stored encrypted here; revoke it in the Convex dashboard if this console is ever compromised.
                </AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="url">API URL</FieldLabel>
              <Input id="url" name="url" type="url" defaultValue={existing?.url} placeholder="https://convex-api.example.com" required />
              <FieldDescription>The instance's <code>SERVICE_URL_BACKEND</code> in Coolify.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="key">Admin key</FieldLabel>
              <Input id="key" name="key" type="password" autoComplete="off" placeholder={existing ? 'Leave empty to keep the current key' : 'self-hosted-convex|01…'} required={!existing} />
              <FieldDescription>In the instance's backend terminal run <code>./generate_admin_key.sh</code>.</FieldDescription>
            </Field>
          </>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Checking…' : existing ? 'Save' : 'Connect'}</Button>
      </DialogFooter>
    </form>
  )
}

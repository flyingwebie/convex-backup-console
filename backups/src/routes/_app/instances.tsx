import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Database, MoreHorizontal, Pencil, Plus, PlugZap, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Confirm } from '~/components/confirm'
import { PageBody, PageHeader } from '~/components/page'
import { StatusBadge } from '~/components/status'
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
import { addInstance, deleteInstance, getInstances, testInstance, updateInstance } from '~/server/fns'

export const Route = createFileRoute('/_app/instances')({
  loader: () => getInstances(),
  component: Instances,
})

type Instance = Awaited<ReturnType<typeof getInstances>>['instances'][number]

function Instances() {
  const { instances, jobs } = Route.useLoaderData()
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
              <EmptyDescription>Connect a Convex deployment with its API URL and an admin key.</EmptyDescription>
            </EmptyHeader>
            {allowed('manage') && <EmptyContent><Button onClick={() => setEditing('new')}><Plus /> Add instance</Button></EmptyContent>}
          </Empty>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>API URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last good backup</TableHead>
                  <TableHead>Jobs</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((i) => {
                  const n = jobs.filter((j) => j.instance_id === i.id).length
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="pl-4 font-medium">{i.name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{i.url}</TableCell>
                      <TableCell>
                        {i.busy ? <StatusBadge status="running" label="Backing up" /> : i.restoring ? <StatusBadge status="running" label="Restoring" /> : i.last_status ? <StatusBadge status={i.last_status} /> : <span className="text-muted-foreground text-sm">—</span>}
                      </TableCell>
                      <TableCell>{timeAgo(i.last_ok_at)}</TableCell>
                      <TableCell>{n}</TableCell>
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
                                <DropdownMenuItem onClick={() => setEditing(i)}><Pencil /> Edit</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <Confirm
                                  trigger={<DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}><Trash2 /> Move to trash</DropdownMenuItem>}
                                  title={`Delete ${i.name}?`}
                                  description={`The instance and its ${n} job${n === 1 ? '' : 's'} move to the Trash and can be restored until the workspace's grace period ends.`}
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
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </PageBody>
      <InstanceDialog instance={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function InstanceDialog({ instance, onClose }: { instance: Instance | 'new' | null; onClose: () => void }) {
  const add = useServerFn(addInstance)
  const update = useServerFn(updateInstance)
  const { run, pending } = useAction()
  const existing = instance && instance !== 'new' ? instance : null

  return (
    <Dialog open={instance !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          key={existing?.id ?? 'new'}
          onSubmit={async (e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const data = { name: String(f.get('name')), url: String(f.get('url')), adminKey: String(f.get('adminKey') ?? '') }
            const ok = existing
              ? await run(() => update({ data: { id: existing.id, ...data } }), { success: (r) => `Saved — Convex ${r.version}` })
              : await run(() => add({ data }), { success: (r) => `Connected — Convex ${r.version}` })
            if (ok) onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>{existing ? `Edit ${existing.name}` : 'Add instance'}</DialogTitle>
            <DialogDescription>The connection and admin key are verified before saving. Keys are stored encrypted.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-6">
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input id="name" name="name" defaultValue={existing?.name} placeholder="acme-prod" required />
              <FieldDescription>Used in backup file paths, e.g. <code>acme-prod/2026-10-14T03-00-00Z.zip</code>.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="url">API URL</FieldLabel>
              <Input id="url" name="url" type="url" defaultValue={existing?.url} placeholder="https://convex-api.example.com" required />
              <FieldDescription>The instance's <code>SERVICE_URL_BACKEND</code> in Coolify.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="adminKey">Admin key</FieldLabel>
              <Input id="adminKey" name="adminKey" type="password" autoComplete="off" placeholder={existing ? 'Leave empty to keep the current key' : 'self-hosted-convex|01…'} required={!existing} />
              <FieldDescription>In the instance's backend terminal run <code>./generate_admin_key.sh</code>.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Checking…' : existing ? 'Save' : 'Connect'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

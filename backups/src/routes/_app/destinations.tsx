import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Cloud, HardDrive, MoreHorizontal, Plus, PlugZap, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Confirm } from '~/components/confirm'
import { PageBody, PageHeader } from '~/components/page'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { useAction } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { addDestination, deleteDestination, getDestinations, testDestination } from '~/server/fns'

export const Route = createFileRoute('/_app/destinations')({
  loader: () => getDestinations(),
  component: Destinations,
})

function Destinations() {
  const { destinations, jobs } = Route.useLoaderData()
  const [open, setOpen] = useState(false)
  const test = useServerFn(testDestination)
  const del = useServerFn(deleteDestination)
  const { run } = useAction()
  const { can: allowed } = useWorkspace()

  return (
    <>
      <PageHeader
        title="Destinations"
        description="Where backups are stored. Use at least one off-site destination."
        actions={allowed('manage') && <Button onClick={() => setOpen(true)}><Plus /> Add destination</Button>}
      />
      <PageBody>
        {destinations.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Cloud /></EmptyMedia>
              <EmptyTitle>No destinations yet</EmptyTitle>
              <EmptyDescription>Cloudflare R2, AWS S3, Backblaze B2, MinIO, or a volume on this server.</EmptyDescription>
            </EmptyHeader>
            {allowed('manage') && <EmptyContent><Button onClick={() => setOpen(true)}><Plus /> Add destination</Button></EmptyContent>}
          </Empty>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Used by</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {destinations.map((d) => {
                  const users = jobs.filter((j) => j.destination_ids.includes(d.id))
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="pl-4 font-medium">{d.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="gap-1">
                          {d.kind === 's3' ? <Cloud className="size-3" /> : <HardDrive className="size-3" />}
                          {d.kind === 's3' ? 'S3-compatible' : 'Local volume'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{d.summary}</TableCell>
                      <TableCell className="text-sm">{users.length ? users.map((j) => j.name).join(', ') : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {allowed('run') && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Actions"><MoreHorizontal /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => run(() => test({ data: { id: d.id } }), { success: `${d.name} is reachable and writable` })}>
                              <PlugZap /> Test access
                            </DropdownMenuItem>
                            {allowed('manage') && (
                              <>
                                <DropdownMenuSeparator />
                                <Confirm
                                  trigger={<DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}><Trash2 /> Move to trash</DropdownMenuItem>}
                                  title={`Delete ${d.name}?`}
                                  description="Jobs stop sending backups here. It stays in the Trash until the grace period ends. Files already stored in it are never deleted."
                                  action="Move to trash"
                                  onConfirm={() => run(() => del({ data: { id: d.id } }), { success: `${d.name} moved to trash` })}
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
      <DestinationDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function DestinationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useServerFn(addDestination)
  const { run, pending } = useAction()
  const [kind, setKind] = useState<'s3' | 'local'>('s3')
  const [pathStyle, setPathStyle] = useState(false)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
            const ok = await run(
              () =>
                add({
                  data:
                    kind === 'local'
                      ? { kind, name: f.name, root: f.root }
                      : { kind, name: f.name, endpoint: f.endpoint, region: f.region || 'auto', bucket: f.bucket, prefix: f.prefix, forcePathStyle: pathStyle, accessKeyId: f.accessKeyId, secretAccessKey: f.secretAccessKey },
                }),
              { success: 'Destination added — access verified' },
            )
            if (ok) onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>Add destination</DialogTitle>
            <DialogDescription>Access is checked before saving. Secrets are stored encrypted.</DialogDescription>
          </DialogHeader>
          <Tabs value={kind} onValueChange={(v) => setKind(v as 's3' | 'local')} className="pt-4">
            <TabsList className="w-full">
              <TabsTrigger value="s3"><Cloud /> S3-compatible</TabsTrigger>
              <TabsTrigger value="local"><HardDrive /> Local volume</TabsTrigger>
            </TabsList>
          </Tabs>
          <FieldGroup className="py-6">
            <Field>
              <FieldLabel htmlFor="d-name">Name</FieldLabel>
              <Input id="d-name" name="name" placeholder={kind === 's3' ? 'r2-eu' : 'local-vault'} required />
            </Field>
            {kind === 'local' ? (
              <Field>
                <FieldLabel htmlFor="root">Path inside the container</FieldLabel>
                <Input id="root" name="root" defaultValue="/data/backups" required />
                <FieldDescription>On the same server as the console, so not off-site. Use it as a fast extra copy.</FieldDescription>
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="endpoint">Endpoint</FieldLabel>
                  <Input id="endpoint" name="endpoint" placeholder="https://<account-id>.r2.cloudflarestorage.com" />
                  <FieldDescription>Leave empty for AWS S3. Backblaze: <code>https://s3.&lt;region&gt;.backblazeb2.com</code>.</FieldDescription>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="bucket">Bucket</FieldLabel>
                    <Input id="bucket" name="bucket" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="region">Region</FieldLabel>
                    <Input id="region" name="region" placeholder="auto" />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="prefix">Folder prefix</FieldLabel>
                  <Input id="prefix" name="prefix" placeholder="convex (optional)" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="accessKeyId">Access key ID</FieldLabel>
                    <Input id="accessKeyId" name="accessKeyId" autoComplete="off" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="secretAccessKey">Secret access key</FieldLabel>
                    <Input id="secretAccessKey" name="secretAccessKey" type="password" autoComplete="off" required />
                  </Field>
                </div>
                <Field orientation="horizontal">
                  <Checkbox id="pathStyle" checked={pathStyle} onCheckedChange={(v) => setPathStyle(v === true)} />
                  <FieldLabel htmlFor="pathStyle" className="font-normal">Path-style URLs (needed for MinIO / RustFS)</FieldLabel>
                </Field>
              </>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Checking access…' : 'Add destination'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Activity, Download, FileLock2, Lock, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { PageBody, PageHeader } from '~/components/page'
import { StatusBadge } from '~/components/status'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { duration, formatBytes, formatDate, timeAgo } from '~/lib/format'
import { useAction, usePolling } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { getRuns, restoreBackup, type RunView } from '~/server/fns'

export const Route = createFileRoute('/_app/runs')({
  validateSearch: z.object({ job: z.string().optional(), tab: z.enum(['backups', 'restores']).optional() }),
  loaderDeps: ({ search }) => ({ job: search.job }),
  loader: ({ deps }) => getRuns({ data: { jobId: deps.job } }),
  component: Runs,
})

type Data = Awaited<ReturnType<typeof getRuns>>
type Source = { run: RunView; destinationId: string; key: string }

const MODES = {
  replaceAll: { label: 'Full restore (replace all tables)', hint: 'The target ends up exactly like the backup. Tables not in the backup are emptied.' },
  replace: { label: 'Replace tables in the backup', hint: 'Only tables present in the backup are overwritten; other tables are untouched.' },
  append: { label: 'Append documents', hint: 'Adds the backup’s documents to existing data. May create duplicates.' },
  requireEmpty: { label: 'Only into an empty instance', hint: 'Fails if the target already has data — the safest choice for a fresh instance.' },
} as const

function Runs() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [source, setSource] = useState<Source | null>(null)
  const { can: allowed } = useWorkspace()
  usePolling(data.runs.some((r) => r.status === 'running') || data.restores.some((r) => r.status === 'running'))
  const destName = (id: string) => data.destinations.find((d) => d.id === id)?.name ?? 'Deleted destination'
  const jobName = search.job ? data.runs.find((r) => r.job_id === search.job)?.job_name : null

  return (
    <>
      <PageHeader title="Runs & restores" description="Every backup run and its copies. Download or restore any copy still stored." />
      <PageBody>
        <Tabs value={search.tab ?? 'backups'} onValueChange={(tab) => navigate({ search: (s) => ({ ...s, tab: tab as 'backups' | 'restores' }) })}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="backups">Backups</TabsTrigger>
              <TabsTrigger value="restores">Restores {data.restores.length > 0 && <Badge variant="secondary">{data.restores.length}</Badge>}</TabsTrigger>
            </TabsList>
            {search.job && (
              <Badge variant="outline" className="gap-1">
                Job: {jobName ?? 'filtered'}
                <Link to="/runs" search={{}} aria-label="Clear filter"><X className="size-3" /></Link>
              </Badge>
            )}
          </div>
          <TabsContent value="backups" className="mt-4">
            {data.runs.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Activity /></EmptyMedia>
                  <EmptyTitle>No runs yet</EmptyTitle>
                  <EmptyDescription>Run a job from the Jobs page, or wait for its schedule.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Card className="py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Started</TableHead>
                      <TableHead>Instance / job</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Copies</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.runs.map((r) => {
                      const available = r.copies.filter((c) => c.status === 'ok' && !c.deleted)
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="pl-4">
                            <Tooltip>
                              <TooltipTrigger asChild><span className="text-sm">{timeAgo(r.started_at)}</span></TooltipTrigger>
                              <TooltipContent>{formatDate(r.started_at)}</TooltipContent>
                            </Tooltip>
                            <div className="text-muted-foreground text-xs">
                              {r.trigger.startsWith('manual:') ? `manual · ${r.trigger.slice(7)}` : r.trigger}
                              {duration(r.started_at, r.finished_at) && ` · ${duration(r.started_at, r.finished_at)}`}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{r.instance_name}</div>
                            <div className="text-muted-foreground text-xs">{r.job_name}</div>
                          </TableCell>
                          <TableCell className="max-w-72 whitespace-normal">
                            <StatusBadge status={r.status} />
                            {r.error && <p className="text-destructive mt-1 text-xs break-words">{r.error}</p>}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {formatBytes(r.bytes)} {r.encrypted && <Lock className="text-muted-foreground inline size-3" aria-label="Encrypted" />}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {r.copies.map((c) => (
                                <Tooltip key={c.destination_id}>
                                  <TooltipTrigger asChild>
                                    <Badge variant={c.status === 'ok' && !c.deleted ? 'secondary' : 'outline'} className={c.status === 'failed' ? 'border-red-500/40 text-red-600' : c.deleted ? 'text-muted-foreground line-through' : ''}>
                                      {destName(c.destination_id)}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>{c.status === 'failed' ? c.error : c.deleted ? 'Pruned by retention' : c.key}</TooltipContent>
                                </Tooltip>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="pr-4 text-right">
                            {available.length > 0 && allowed('download') && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline">Use backup</Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64">
                                  {available.map((c, idx) => (
                                    <div key={c.destination_id}>
                                      {idx > 0 && <DropdownMenuSeparator />}
                                      <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">From {destName(c.destination_id)}</DropdownMenuLabel>
                                      {allowed('restore') && (
                                        <DropdownMenuItem onClick={() => setSource({ run: r, destinationId: c.destination_id, key: c.key })}>
                                          <RotateCcw /> Restore…
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem asChild>
                                        <a href={`/api/download?run=${r.id}&dest=${c.destination_id}`}><Download /> Download zip</a>
                                      </DropdownMenuItem>
                                      {c.key.endsWith('.age') && (
                                        <DropdownMenuItem asChild>
                                          <a href={`/api/download?run=${r.id}&dest=${c.destination_id}&raw=1`}><FileLock2 /> Download encrypted (.age)</a>
                                        </DropdownMenuItem>
                                      )}
                                    </div>
                                  ))}
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
          </TabsContent>
          <TabsContent value="restores" className="mt-4">
            <RestoresTable data={data} />
          </TabsContent>
        </Tabs>
      </PageBody>
      {source && <RestoreDialog data={data} source={source} onClose={() => setSource(null)} onDone={() => navigate({ search: (s) => ({ ...s, tab: 'restores' }) })} />}
    </>
  )
}

function RestoresTable({ data }: { data: Data }) {
  if (data.restores.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><RotateCcw /></EmptyMedia>
          <EmptyTitle>No restores yet</EmptyTitle>
          <EmptyDescription>Restore any stored copy from the Backups tab. Practise on a test instance first.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Started</TableHead>
            <TableHead>Backup</TableHead>
            <TableHead>Into</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.restores.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="pl-4">
                <div className="text-sm">{timeAgo(r.started_at)}</div>
                <div className="text-muted-foreground text-xs">{r.actor}</div>
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-xs whitespace-normal break-all">{r.object_key}</TableCell>
              <TableCell className="font-medium">{r.target_name}</TableCell>
              <TableCell className="text-sm">{MODES[r.mode as keyof typeof MODES]?.label ?? r.mode}</TableCell>
              <TableCell className="max-w-80 whitespace-normal">
                <StatusBadge status={r.status} />
                {r.rows_written != null && <span className="text-muted-foreground ml-2 text-xs">{r.rows_written.toLocaleString()} documents</span>}
                {r.error && <p className="text-destructive mt-1 text-xs break-words">{r.error}</p>}
                {r.confirm_message && (
                  <details className="mt-1">
                    <summary className="text-muted-foreground cursor-pointer text-xs">Change summary</summary>
                    <pre className="bg-muted mt-1 overflow-x-auto rounded p-2 text-[11px] leading-tight">{r.confirm_message}</pre>
                  </details>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

function RestoreDialog({ data, source, onClose, onDone }: { data: Data; source: Source; onClose: () => void; onDone: () => void }) {
  const restore = useServerFn(restoreBackup)
  const { run, pending } = useAction()
  const [targetId, setTargetId] = useState(source.run.instance_id ?? data.instances[0]?.id ?? '')
  const [mode, setMode] = useState<keyof typeof MODES>('replaceAll')
  const [confirm, setConfirm] = useState('')
  const target = data.instances.find((i) => i.id === targetId)
  const sameInstance = targetId === source.run.instance_id

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const ok = await run(
              () => restore({ data: { runId: source.run.id, destinationId: source.destinationId, targetInstanceId: targetId, mode, confirm } }),
              { success: `Restore into ${target?.name} started` },
            )
            if (ok) {
              onClose()
              onDone()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Restore backup</DialogTitle>
            <DialogDescription>
              {source.run.instance_name} · {formatDate(source.run.started_at)} · {formatBytes(source.run.bytes)}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-6">
            <Field>
              <FieldLabel>Restore into</FieldLabel>
              <Select value={targetId} onValueChange={(v) => { setTargetId(v); setConfirm('') }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.instances.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name}{i.id === source.run.instance_id ? ' (original)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Mode</FieldLabel>
              <Select value={mode} onValueChange={(v) => setMode(v as keyof typeof MODES)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(MODES).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldDescription>{MODES[mode].hint}</FieldDescription>
            </Field>
            {mode !== 'requireEmpty' && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>This overwrites data in {target?.name}</AlertTitle>
                <AlertDescription>
                  {sameInstance
                    ? 'You are restoring over the original instance. Consider taking a fresh backup first.'
                    : 'Make sure this is the instance you mean — restores cannot be undone.'}
                </AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="confirm">Type <span className="font-mono">{target?.name}</span> to confirm</FieldLabel>
              <Input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending || !target || confirm !== target.name}>
              <RotateCcw /> Restore into {target?.name}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

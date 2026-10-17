import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Activity, ArrowDown, ArrowUp, ArrowUpDown, Download, EyeOff, FileLock2, ListTree, Lock, MoreHorizontal, RotateCcw, Search, Trash2, TriangleAlert, X } from 'lucide-react'
import { RunContents } from '~/components/run-contents'
import { Checkbox } from '~/components/ui/checkbox'
import { Switch } from '~/components/ui/switch'
import { FieldContent } from '~/components/ui/field'
import { getRunContents, getScrubRules } from '~/server/fns'
import { useServerFn as useFn } from '@tanstack/react-start'
import { useEffect } from 'react'
import { useMemo, useState } from 'react'
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
import { deleteRun, getRuns, restoreBackup, type RunView } from '~/server/fns'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '~/components/ui/alert-dialog'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export const Route = createFileRoute('/_app/runs')({
  validateSearch: z.object({
    job: z.string().optional(),
    tab: z.enum(['backups', 'restores']).optional(),
    from: z.string().regex(DAY_RE).optional().catch(undefined),
    to: z.string().regex(DAY_RE).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ job: search.job, from: search.from, to: search.to }),
  loader: ({ deps }) => getRuns({ data: { jobId: deps.job, from: deps.from, to: deps.to } }),
  component: Runs,
})

type Data = Awaited<ReturnType<typeof getRuns>>
type Source = { run: RunView; destinationId: string; key: string }
type SortKey = 'started' | 'instance' | 'status' | 'size'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }

const STATUSES = { ok: 'Succeeded', partial: 'Partial', failed: 'Failed', running: 'Running' } as const
const STATUS_ORDER = { failed: 0, partial: 1, running: 2, ok: 3 } as const

/** Start of a local calendar day ('YYYY-MM-DD'), optionally shifted by whole days. */
function localDay(day: string, shift = 0) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d + shift).getTime()
}

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
  const [contents, setContents] = useState<RunView | null>(null)
  const [deleting, setDeleting] = useState<RunView | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | keyof typeof STATUSES>('all')
  const [instance, setInstance] = useState('all')
  const [sort, setSort] = useState<Sort>({ key: 'started', dir: 'desc' })
  const { can: allowed } = useWorkspace()
  usePolling(data.runs.some((r) => r.status === 'running') || data.restores.some((r) => r.status === 'running'))
  const destName = (id: string) => data.destinations.find((d) => d.id === id)?.name ?? 'Deleted destination'
  const jobName = search.job ? data.runs.find((r) => r.job_id === search.job)?.job_name : null
  const instances = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of data.runs) seen.set(r.instance_id ?? 'deleted', r.instance_name)
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data.runs])
  const runs = useMemo(() => {
    const q = query.trim().toLowerCase()
    const from = search.from ? localDay(search.from) : -Infinity
    const to = search.to ? localDay(search.to, 1) : Infinity
    const list = data.runs.filter(
      (r) =>
        r.started_at >= from &&
        r.started_at < to &&
        (status === 'all' || r.status === status) &&
        (instance === 'all' || (r.instance_id ?? 'deleted') === instance) &&
        (!q ||
          [r.instance_name, r.job_name, r.trigger, r.error ?? '', r.status, ...r.copies.map((c) => destName(c.destination_id))]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    )
    const value = (r: RunView): number | string =>
      sort.key === 'started' ? r.started_at : sort.key === 'size' ? (r.bytes ?? -1) : sort.key === 'status' ? STATUS_ORDER[r.status] : `${r.instance_name} ${r.job_name}`.toLowerCase()
    const dir = sort.dir === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      const x = value(a)
      const y = value(b)
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (b.started_at - a.started_at)
    })
  }, [data.runs, query, status, instance, sort, search.from, search.to])
  const filtering = Boolean(query || status !== 'all' || instance !== 'all' || search.from || search.to)
  const setDates = (next: { from?: string; to?: string }) =>
    navigate({ search: (s) => ({ ...s, from: next.from || undefined, to: next.to || undefined }), replace: true })
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'instance' ? 'asc' : 'desc' }))
  const clearFilters = () => {
    setQuery('')
    setStatus('all')
    setInstance('all')
    setDates({})
  }

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
            {data.runs.length > 0 || search.from || search.to ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="relative min-w-56 flex-1">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search instance, job, destination, error…" className="pl-8" aria-label="Search backups" />
                </div>
                <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                  <SelectTrigger className="w-36" aria-label="Status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {Object.entries(STATUSES).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={instance} onValueChange={setInstance}>
                  <SelectTrigger className="w-44" aria-label="Instance"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All instances</SelectItem>
                    {instances.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <Input type="date" value={search.from ?? ''} max={search.to} onChange={(e) => setDates({ from: e.target.value, to: search.to })} className="w-36" aria-label="From date" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input type="date" value={search.to ?? ''} min={search.from} onChange={(e) => setDates({ from: search.from, to: e.target.value })} className="w-36" aria-label="To date" />
                </div>
                {filtering && (
                  <Button size="sm" variant="ghost" onClick={clearFilters}><X /> Clear</Button>
                )}
              </div>
            ) : null}
            {data.runs.length === 0 && !search.from && !search.to ? (
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
                      <SortHead label="Started" k="started" sort={sort} onSort={toggleSort} className="pl-4" />
                      <SortHead label="Instance / job" k="instance" sort={sort} onSort={toggleSort} />
                      <SortHead label="Status" k="status" sort={sort} onSort={toggleSort} />
                      <SortHead label="Size" k="size" sort={sort} onSort={toggleSort} />
                      <TableHead>Copies</TableHead>
                      <TableHead className="w-52" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-muted-foreground py-10 text-center text-sm">
                          No backups match these filters.{' '}
                          {filtering && <button type="button" className="underline" onClick={clearFilters}>Clear filters</button>}
                        </TableCell>
                      </TableRow>
                    )}
                    {runs.map((r) => {
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
                                  <TooltipContent>
                                    {c.status === 'failed' ? c.error : c.deleted ? 'Pruned by retention' : c.key}
                                    {c.locked_until && c.locked_until > Date.now() && ` · locked until ${formatDate(c.locked_until)}`}
                                  </TooltipContent>
                                </Tooltip>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="pr-4 text-right">
                            <div className="flex justify-end gap-1">
                            {(r.status === 'ok' || r.status === 'partial') && (
                              <Button size="sm" variant="ghost" onClick={() => setContents(r)} aria-label="Contents">
                                <ListTree /> Contents
                              </Button>
                            )}
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
                            {allowed('purge') && r.status !== 'running' && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon-sm" variant="ghost" aria-label="More actions"><MoreHorizontal /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(r)}>
                                    <Trash2 /> Delete backup…
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            </div>
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
      <RunContents run={contents} onClose={() => setContents(null)} />
      {deleting && <DeleteRunDialog run={deleting} destName={destName} onClose={() => setDeleting(null)} />}
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
              <TableCell className="text-sm">
                {MODES[r.mode as keyof typeof MODES]?.label ?? r.mode}
                {r.tables && <div className="text-muted-foreground font-mono text-xs">{(JSON.parse(r.tables) as string[]).join(', ')}</div>}
                {r.scrubbed ? <Badge variant="outline" className="mt-1 gap-1"><EyeOff className="size-3" /> scrubbed</Badge> : null}
              </TableCell>
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
  const [scope, setScope] = useState<'all' | 'tables'>('all')
  const [tables, setTables] = useState<string[]>([])
  const [includeFiles, setIncludeFiles] = useState(false)
  const [scrub, setScrub] = useState(false)
  const [available, setAvailable] = useState<string[] | null>(null)
  const [ruleCount, setRuleCount] = useState(0)
  const loadContents = useFn(getRunContents)
  const loadRules = useFn(getScrubRules)
  useEffect(() => {
    void loadContents({ data: { id: source.run.id } }).then((c) => setAvailable(c.manifest?.tables.map((t) => t.name) ?? []))
    void loadRules().then((r) => setRuleCount(r.rules.length))
  }, [source.run.id])
  const target = data.instances.find((i) => i.id === targetId)
  const sameInstance = targetId === source.run.instance_id

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const ok = await run(
              () =>
                restore({
                  data: {
                    runId: source.run.id,
                    destinationId: source.destinationId,
                    targetInstanceId: targetId,
                    mode,
                    confirm,
                    ...(scope === 'tables' && { tables, includeFiles }),
                    scrub,
                  },
                }),
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
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                      {i.kind === 'cloud' ? ` (Cloud ${i.deployment_type ?? ''})` : ''}
                      {i.id === source.run.instance_id ? ' — original' : ''}
                    </SelectItem>
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
            <Field>
              <FieldLabel>What to restore</FieldLabel>
              <Select value={scope} onValueChange={(v) => setScope(v as 'all' | 'tables')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everything (all tables and files)</SelectItem>
                  <SelectItem value="tables" disabled={!available?.length}>Selected tables only</SelectItem>
                </SelectContent>
              </Select>
              {available && available.length === 0 && (
                <FieldDescription>Open this backup's Contents and inspect it to restore individual tables.</FieldDescription>
              )}
            </Field>
            {scope === 'tables' && available && (
              <Field>
                <FieldLabel>Tables</FieldLabel>
                <div className="grid max-h-44 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
                  {available.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={tables.includes(t)} onCheckedChange={(v) => setTables((x) => (v ? [...x, t] : x.filter((y) => y !== t)))} />
                      <span className="truncate font-mono text-xs">{t}</span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={includeFiles} onCheckedChange={(v) => setIncludeFiles(v === true)} /> Also restore stored files
                </label>
                <FieldDescription>Only the selected tables are replaced; every other table in {target?.name} is left as it is.</FieldDescription>
              </Field>
            )}
            <Field orientation="horizontal" className="rounded-md border p-3">
              <FieldContent>
                <FieldLabel htmlFor="scrub" className="flex items-center gap-2"><EyeOff className="size-4" /> Scrub personal data</FieldLabel>
                <FieldDescription>
                  {ruleCount
                    ? `Apply the workspace's ${ruleCount} scrubbing rule${ruleCount === 1 ? '' : 's'} (fake emails, names…) before importing — for staging copies.`
                    : 'No scrubbing rules yet — add them in Workspace settings → Data scrubbing.'}
                </FieldDescription>
              </FieldContent>
              <Switch id="scrub" checked={scrub} disabled={!ruleCount} onCheckedChange={setScrub} />
            </Field>
            {target?.kind === 'cloud' && target.deployment_type === 'prod' && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Convex Cloud production deployment</AlertTitle>
                <AlertDescription>
                  {target.deployment_name} serves live users. Convex Cloud also keeps its own backups (dashboard → Backups) — consider restoring into a
                  development deployment first.
                </AlertDescription>
              </Alert>
            )}
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
            <Button type="submit" variant="destructive" disabled={pending || !target || confirm !== target.name || (scope === 'tables' && tables.length === 0)}>
              <RotateCcw /> Restore into {target?.name}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SortHead({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={() => onSort(k)}>
        {label} <Icon className={active ? '' : 'text-muted-foreground/60'} />
      </Button>
    </TableHead>
  )
}

/** Two confirmations: first explains what goes, then asks to type DELETE. */
function DeleteRunDialog({ run: r, destName, onClose }: { run: RunView; destName: (id: string) => string; onClose: () => void }) {
  const del = useServerFn(deleteRun)
  const { run, pending } = useAction()
  const [step, setStep] = useState<1 | 2>(1)
  const [confirm, setConfirm] = useState('')
  const stored = r.copies.filter((c) => c.status === 'ok' && !c.deleted)
  const locked = stored.filter((c) => c.locked_until && c.locked_until > Date.now())
  const label = `${r.instance_name} · ${formatDate(r.started_at)}`

  return (
    <AlertDialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        {step === 1 ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>{label} · {formatBytes(r.bytes)}</p>
                  {stored.length > 0 ? (
                    <p>
                      Its file{stored.length === 1 ? '' : 's'} will be permanently deleted from{' '}
                      <span className="text-foreground font-medium">{stored.map((c) => destName(c.destination_id)).join(', ')}</span>, and the run removed from history.
                    </p>
                  ) : (
                    <p>No stored files are left for this run — only its history entry is removed.</p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            {locked.length > 0 && (
              <Alert variant="destructive">
                <Lock />
                <AlertTitle>Under Object Lock</AlertTitle>
                <AlertDescription>
                  The copy on {locked.map((c) => destName(c.destination_id)).join(', ')} can’t be deleted until {formatDate(Math.max(...locked.map((c) => c.locked_until!)))}.
                </AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button variant="destructive" disabled={locked.length > 0} onClick={() => setStep(2)}>Continue</Button>
            </AlertDialogFooter>
          </>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (confirm !== 'DELETE') return
              const ok = await run(() => del({ data: { id: r.id, confirm: 'DELETE' } }).then(() => true), { success: 'Backup deleted' })
              if (ok) onClose()
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2"><TriangleAlert className="text-destructive size-5" /> This can’t be undone</AlertDialogTitle>
              <AlertDialogDescription>
                {label} will be gone for good. You won’t be able to restore or download it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Field>
              <FieldLabel htmlFor="delete-confirm">Type <span className="font-mono">DELETE</span> to confirm</FieldLabel>
              <Input id="delete-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoFocus />
            </Field>
            <AlertDialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setStep(1)}>Back</Button>
              <Button type="submit" variant="destructive" disabled={pending || confirm !== 'DELETE'}>
                <Trash2 /> Delete permanently
              </Button>
            </AlertDialogFooter>
          </form>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

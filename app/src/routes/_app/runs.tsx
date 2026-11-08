import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Download,
  EyeOff,
  FileLock2,
  ListTree,
  Lock,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  SquareTerminal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { RunContents } from '~/components/run-contents'
import { RestoreTerminal } from '~/components/restore-terminal'
import { Checkbox } from '~/components/ui/checkbox'
import { Switch } from '~/components/ui/switch'
import { FieldContent } from '~/components/ui/field'
import { getRunContents, getScrubRules } from '~/server/fns'
import { useServerFn as useFn } from '@tanstack/react-start'
import { Fragment, useEffect } from 'react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { PageBody, PageHeader } from '~/components/page'
import { NodeCard, PipelineSteps, StatusDot, EntityChip, type DotStatus, type PipelineStepItem } from '~/components/viz'
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
import { duration, formatBytes, formatDate, stageDuration, timeAgo } from '~/lib/format'
import { cn } from '~/lib/utils'
import { useAction, usePolling } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { deleteRun, getRuns, restoreBackup, runJobNow, type RunView } from '~/server/fns'
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
const RUN_DOT: Record<RunView['status'], DotStatus> = { ok: 'success', partial: 'warning', failed: 'danger', running: 'running' }

/** Status dot + plain word (DESIGN.md §5.3: "dot + word, instead of a colored badge background"). */
function RunStatus({ status, label }: { status: RunView['status']; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', status === 'failed' && 'font-medium text-danger', status === 'running' && 'font-medium')}>
      <StatusDot status={RUN_DOT[status]} />
      {label ?? STATUSES[status]}
    </span>
  )
}

const STAGE_LABELS: Record<string, string> = { export: 'Export', compress: 'Compress', encrypt: 'Encrypt', upload: 'Upload', verify: 'Verify' }
const STAGE_ORDER = ['export', 'compress', 'encrypt', 'upload', 'verify'] as const

/** Real per-stage timings recorded by backup.server.ts (`runs.stages`), with real durations ("12.4s"). */
function stepsFromStages(stages: NonNullable<RunView['stages']>): PipelineStepItem[] {
  return STAGE_ORDER.map((id) => {
    const s = stages.find((x) => x.id === id)
    if (!s) return { id, label: STAGE_LABELS[id], status: 'pending' as const }
    const detail = s.status === 'failed' || s.status === 'skipped' ? s.detail : (stageDuration(s.startedAt, s.endedAt) ?? undefined)
    return { id, label: STAGE_LABELS[id], status: s.status, detail }
  })
}

/**
 * Honest run → PipelineStep mapping (DESIGN.md §5.4/§5.6: "map existing run statuses to pipeline
 * states honestly, don't fake timings"). Runs made since per-stage tracking shipped carry real
 * timings in `r.stages` (used via `stepsFromStages` above, including a live active step while the
 * run is in progress and a real Verify stage). Older runs have `stages: null`; for those we fall
 * back to deriving status only from what was persisted before: overall run status, whether the
 * archive was encrypted, and each destination's own copy status — never a faked duration.
 */
function deriveRunSteps(r: RunView): PipelineStepItem[] {
  if (r.stages?.length) return stepsFromStages(r.stages)

  const copies = r.copies.filter((c) => !c.deleted)
  const anyUploadFailed = copies.some((c) => c.status === 'failed')
  const allUploadOk = copies.length > 0 && copies.every((c) => c.status === 'ok')

  if (r.status === 'running') {
    return [
      { id: 'export', label: 'Export', status: 'done' },
      { id: 'compress', label: 'Compress', status: 'done' },
      { id: 'encrypt', label: 'Encrypt', status: r.encrypted ? 'done' : 'skipped' },
      { id: 'upload', label: 'Upload', status: 'active' },
      { id: 'verify', label: 'Verify', status: 'pending' },
    ]
  }
  if (r.status === 'failed' && r.bytes == null) {
    // Failed before an archive was produced — the earliest stage is the honest place to put it.
    return [
      { id: 'export', label: 'Export', status: 'failed', detail: r.error ?? undefined },
      { id: 'compress', label: 'Compress', status: 'pending' },
      { id: 'encrypt', label: 'Encrypt', status: 'pending' },
      { id: 'upload', label: 'Upload', status: 'pending' },
      { id: 'verify', label: 'Verify', status: 'pending' },
    ]
  }
  if (r.status === 'failed' && r.encrypted === false && /encrypt|key/i.test(r.error ?? '')) {
    return [
      { id: 'export', label: 'Export', status: 'done' },
      { id: 'compress', label: 'Compress', status: 'done' },
      { id: 'encrypt', label: 'Encrypt', status: 'failed', detail: r.error ?? undefined },
      { id: 'upload', label: 'Upload', status: 'pending' },
      { id: 'verify', label: 'Verify', status: 'pending' },
    ]
  }
  return [
    { id: 'export', label: 'Export', status: 'done' },
    { id: 'compress', label: 'Compress', status: 'done' },
    { id: 'encrypt', label: 'Encrypt', status: r.encrypted ? 'done' : 'skipped' },
    {
      id: 'upload',
      label: 'Upload',
      status: copies.length === 0 ? (r.status === 'failed' ? 'failed' : 'skipped') : anyUploadFailed ? (allUploadOk ? 'done' : 'failed') : 'done',
      detail: anyUploadFailed ? copies.find((c) => c.status === 'failed')?.error ?? undefined : undefined,
    },
    { id: 'verify', label: 'Verify', status: 'skipped', detail: 'not recorded for this backup' },
  ]
}

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
  const [expanded, setExpanded] = useState<string | null>(null)
  const { can: allowed } = useWorkspace()
  const runNow = useServerFn(runJobNow)
  const { run: runAction, pending: runPending } = useAction()
  const busy = data.runs.some((r) => r.status === 'running') || data.restores.some((r) => r.status === 'running')
  usePolling(busy)
  const destName = (id: string) => data.destinations.find((d) => d.id === id)?.name ?? 'Deleted destination'
  const jobName = search.job ? data.runs.find((r) => r.job_id === search.job)?.job_name : null
  const instances = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of data.runs) seen.set(r.instance_id ?? 'deleted', r.instance_name)
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data.runs])
  // Jobs that still exist are listed under the "Run a job" dropdown — reconstructed from runs since
  // this route doesn't load the jobs table (keeps the loader unchanged; see getRuns payload).
  const runnableJobs = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>()
    for (const r of data.runs) if (r.job_id) seen.set(r.job_id, { id: r.job_id, name: r.job_name })
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
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
      <PageHeader
        title="Runs & restores"
        description="Every backup run and its copies. Download or restore any copy still stored."
        actions={
          <>
            <Button size="sm" variant="outline" disabled={runPending} onClick={() => navigate({})}>
              <RefreshCw className={runPending ? 'animate-spin' : ''} /> Refresh
            </Button>
            {allowed('run') && runnableJobs.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" disabled={runPending}>
                    <Play /> Run a job
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {runnableJobs.map((j) => (
                    <DropdownMenuItem key={j.id} onClick={() => runAction(() => runNow({ data: { id: j.id } }), { success: `${j.name} started` })}>
                      <Play /> {j.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
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
                <span className="text-muted-foreground ml-auto hidden font-mono text-xs sm:inline">{runs.length} runs</span>
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
              <>
                {/* Mobile: stacked cards (DESIGN.md §6 "runs-mobile": table rows don't survive 390px). */}
                <div className="flex flex-col gap-3 sm:hidden">
                  {runs.length === 0 && (
                    <p className="text-muted-foreground py-10 text-center text-sm">
                      No backups match these filters. {filtering && <button type="button" className="underline" onClick={clearFilters}>Clear filters</button>}
                    </p>
                  )}
                  {runs.map((r) => (
                    <RunMobileCard key={r.id} r={r} destName={destName} onContents={() => setContents(r)} />
                  ))}
                </div>
                <Card className="hidden py-0 sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortHead label="Started" k="started" sort={sort} onSort={toggleSort} className="pl-4" />
                        <SortHead label="Instance / job" k="instance" sort={sort} onSort={toggleSort} />
                        <SortHead label="Status" k="status" sort={sort} onSort={toggleSort} />
                        <TableHead>Pipeline</TableHead>
                        <SortHead label="Size" k="size" sort={sort} onSort={toggleSort} />
                        <TableHead>Copies</TableHead>
                        <TableHead className="w-52" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-muted-foreground py-10 text-center text-sm">
                            No backups match these filters.{' '}
                            {filtering && <button type="button" className="underline" onClick={clearFilters}>Clear filters</button>}
                          </TableCell>
                        </TableRow>
                      )}
                      {runs.map((r) => {
                        const available = r.copies.filter((c) => c.status === 'ok' && !c.deleted)
                        const steps = deriveRunSteps(r)
                        const isExpanded = expanded === r.id
                        return (
                          <Fragment key={r.id}>
                            <TableRow>
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
                              <TableCell className="max-w-52 whitespace-normal">
                                <RunStatus status={r.status} />
                                {r.error && <p className="text-danger mt-1 text-xs break-words">{r.error}</p>}
                              </TableCell>
                              <TableCell>
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent"
                                  onClick={() => setExpanded((e) => (e === r.id ? null : r.id))}
                                  aria-expanded={isExpanded}
                                  aria-label="Toggle pipeline detail"
                                >
                                  <PipelineSteps steps={steps} compact />
                                  <ChevronDown className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', isExpanded && 'rotate-180')} />
                                </button>
                              </TableCell>
                              <TableCell className="text-sm whitespace-nowrap">
                                {formatBytes(r.bytes)} {r.encrypted && <Lock className="text-muted-foreground inline size-3" aria-label="Encrypted" />}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {r.copies.map((c) => (
                                    <Tooltip key={c.destination_id}>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <EntityChip
                                            kind="destination"
                                            name={destName(c.destination_id)}
                                            status={c.status === 'ok' && !c.deleted ? 'success' : c.status === 'failed' ? 'danger' : 'neutral'}
                                            size="sm"
                                            className={c.deleted ? 'text-muted-foreground line-through' : c.status === 'failed' ? 'border-danger/40' : ''}
                                          />
                                        </span>
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
                            {isExpanded && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={7} className="bg-muted/40 py-3">
                                  <PipelineSteps steps={steps} />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                </Card>
                <p className="text-muted-foreground hidden font-mono text-xs sm:block">
                  Pipeline: Export → Compress → Encrypt → Upload → Verify ·{' '}
                  <span className="text-success">●</span> done ·{' '}
                  <span className="text-running">●</span> active ·{' '}
                  <span className="text-danger">●</span> failed ·{' '}
                  <span className="text-muted-foreground">—</span> skipped
                </p>
              </>
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

/** Mobile (≤640px) stacked-card equivalent of a backups table row (DESIGN.md "runs-mobile"). */
function RunMobileCard({ r, destName, onContents }: { r: RunView; destName: (id: string) => string; onContents: () => void }) {
  const steps = deriveRunSteps(r)
  return (
    <Card className={cn('gap-2 p-4', r.status === 'failed' && 'border-danger/40')}>
      <div className="flex items-start justify-between gap-2">
        <RunStatus status={r.status} label={`${STATUSES[r.status]} · ${timeAgo(r.started_at)}`} />
        <span className="text-sm whitespace-nowrap">
          {formatBytes(r.bytes)} {r.encrypted && <Lock className="text-muted-foreground inline size-3" aria-label="Encrypted" />}
        </span>
      </div>
      <div>
        <div className="font-medium">{r.instance_name}</div>
        <div className="text-muted-foreground text-xs">{r.job_name}</div>
      </div>
      <PipelineSteps steps={steps} compact />
      {r.error && <p className="text-danger text-xs break-words">{r.error}</p>}
      <div className="flex flex-wrap gap-1">
        {r.copies.map((c) => (
          <EntityChip
            key={c.destination_id}
            kind="destination"
            name={destName(c.destination_id)}
            status={c.status === 'ok' && !c.deleted ? 'success' : c.status === 'failed' ? 'danger' : 'neutral'}
            size="sm"
            className={c.deleted ? 'text-muted-foreground line-through' : ''}
          />
        ))}
      </div>
      {(r.status === 'ok' || r.status === 'partial') && (
        <Button size="sm" variant="outline" className="self-start" onClick={onContents}>
          <ListTree /> Contents
        </Button>
      )}
    </Card>
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
    <div className="flex flex-col gap-3">
      {data.restores.map((r) => (
        <RestoreCard key={r.id} r={r} />
      ))}
    </div>
  )
}

const DEST_KIND: Record<string, string> = { s3: 'S3', r2: 'R2', local: 'Local disk' }

function RestoreCard({ r }: { r: Data['restores'][number] }) {
  const [open, setOpen] = useState(r.status === 'running')
  useEffect(() => {
    if (r.status === 'running') setOpen(true)
  }, [r.status])
  const tables = r.tables ? (JSON.parse(r.tables) as string[]) : null
  const source = r.source_name ?? 'Deleted instance'
  const running = r.status === 'running'
  const edgeStatus: DotStatus = running ? 'running' : r.status === 'failed' ? 'danger' : 'success'

  return (
    <Card className="gap-0 py-0">
      {/* Restore lineage (DESIGN.md §5.1/§5.5: NodeCard pair + Edge, "source backup → target instance"). */}
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:flex-row">
          <NodeCard kind="run" title={source} subtitle={r.backup_at ? `Backup ${formatDate(r.backup_at)}` : undefined} status="neutral" />
          <div className="flex flex-1 flex-col items-center gap-1">
            {running && <Badge variant="outline" className="gap-1 text-running"><StatusDot status="running" size="sm" /> live</Badge>}
            {!running && r.finished_at && <span className="text-muted-foreground font-mono text-[11px]">{duration(r.started_at, r.finished_at)}</span>}
            <div className="relative h-0 w-full min-w-10">
              <div className={cn('absolute inset-x-0 top-0 h-px', running ? 'edge-dash-flow border-t border-dashed border-running' : r.status === 'failed' ? 'bg-danger' : 'bg-success')} />
            </div>
          </div>
          <NodeCard kind="instance" title={r.target_name} subtitle={r.target_url ?? undefined} status={edgeStatus} />
        </div>
        <div className="flex shrink-0 flex-col gap-1 lg:w-56 lg:items-end lg:text-right">
          <div className="flex items-center gap-2 lg:justify-end">
            <RunStatus status={r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'failed' : 'running'} label={r.status === 'ok' ? 'Succeeded' : r.status === 'failed' ? 'Failed' : 'Running'} />
            {r.rows_written != null && <span className="text-muted-foreground text-xs">{r.rows_written.toLocaleString()} documents</span>}
          </div>
          <div className="text-muted-foreground text-xs">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{timeAgo(r.started_at)}</span>
              </TooltipTrigger>
              <TooltipContent>{formatDate(r.started_at)}</TooltipContent>
            </Tooltip>
            {r.finished_at && <> · took {duration(r.started_at, r.finished_at)}</>}
          </div>
          <div className="text-muted-foreground truncate text-xs">by {r.actor}</div>
          <Button variant="ghost" size="sm" className="-mr-2 h-7 gap-1.5 self-start text-xs lg:self-end" onClick={() => setOpen((o) => !o)}>
            <SquareTerminal className="size-3.5" />
            {open ? 'Hide log' : 'Show log'}
            <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </div>
      {(tables || r.scrubbed || r.error || r.destination_name) && (
        <div className="flex flex-col gap-1.5 border-t px-4 py-2">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span>From</span>
            <EntityChip kind="destination" name={r.destination_name ?? 'Deleted destination'} meta={r.destination_kind ? (DEST_KIND[r.destination_kind] ?? r.destination_kind) : undefined} size="sm" />
            {r.mode && <span>· {MODES[r.mode as keyof typeof MODES]?.label ?? r.mode}</span>}
          </div>
          {Boolean(tables || r.scrubbed) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {tables && <span className="text-muted-foreground text-xs">Tables:</span>}
              {tables?.map((t) => (
                <Badge key={t} variant="secondary" className="font-mono text-[11px]">{t}</Badge>
              ))}
              {r.scrubbed ? <Badge variant="outline" className="gap-1"><EyeOff className="size-3" /> scrubbed</Badge> : null}
            </div>
          )}
          {r.error && <p className="text-danger text-xs break-words">{r.error}</p>}
        </div>
      )}
      {open && (
        <div className="border-t p-3">
          <RestoreTerminal
            restoreId={r.id}
            title={`restore ${source} → ${r.target_name} · ${r.object_key}`}
            status={r.status}
            startedAt={r.started_at}
            finishedAt={r.finished_at}
            fallback={r.log_lines === 0 ? r.confirm_message : null}
          />
        </div>
      )}
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
                <FieldLabel htmlFor="scrub">Scrub personal data</FieldLabel>
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

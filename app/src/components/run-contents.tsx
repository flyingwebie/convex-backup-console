import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ArrowDownRight, ArrowUpRight, FileSearch, Minus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet'
import { Skeleton } from '~/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { BreadcrumbTrail, EntityChip, PipelineSteps, type PipelineStepItem } from '~/components/viz'
import { formatBytes, formatDate, stageDuration } from '~/lib/format'
import { useAction } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { getRunContents, inspectRun, type RunView } from '~/server/fns'

type Contents = Awaited<ReturnType<typeof getRunContents>>

function Delta({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return <Badge variant="secondary">new</Badge>
  const d = now - before
  if (d === 0) return <span className="text-muted-foreground inline-flex items-center gap-1 text-xs"><Minus className="size-3" /> 0</span>
  const up = d > 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${up ? 'text-success' : 'text-warning'}`}>
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {up ? '+' : ''}
      {d.toLocaleString()}
    </span>
  )
}

const STAGE_LABELS: Record<string, string> = { export: 'Export', compress: 'Compress', encrypt: 'Encrypt', upload: 'Upload', verify: 'Verify' }
const STAGE_ORDER = ['export', 'compress', 'encrypt', 'upload', 'verify'] as const

/**
 * Same mapping as the Runs table's mini pipeline strip (DESIGN.md §5.4). Runs with recorded
 * per-stage timings (`run.stages`) show real durations and a real Verify step; older runs fall
 * back to the honest status-only derivation — never a faked duration. Kept local (rather than
 * imported from the route) to avoid a route→component import.
 */
function deriveSteps(run: RunView): PipelineStepItem[] {
  if (run.stages?.length) {
    return STAGE_ORDER.map((id) => {
      const s = run.stages!.find((x) => x.id === id)
      if (!s) return { id, label: STAGE_LABELS[id], status: 'pending' as const }
      const detail = s.status === 'failed' || s.status === 'skipped' ? s.detail : (stageDuration(s.startedAt, s.endedAt) ?? undefined)
      return { id, label: STAGE_LABELS[id], status: s.status, detail }
    })
  }
  const copies = run.copies.filter((c) => !c.deleted)
  const anyFailed = copies.some((c) => c.status === 'failed')
  const allOk = copies.length > 0 && copies.every((c) => c.status === 'ok')
  if (run.status === 'running') {
    return [
      { id: 'export', label: 'Export', status: 'done' },
      { id: 'compress', label: 'Compress', status: 'done' },
      { id: 'encrypt', label: 'Encrypt', status: run.encrypted ? 'done' : 'skipped' },
      { id: 'upload', label: 'Upload', status: 'active' },
      { id: 'verify', label: 'Verify', status: 'pending' },
    ]
  }
  return [
    { id: 'export', label: 'Export', status: 'done' },
    { id: 'compress', label: 'Compress', status: 'done' },
    { id: 'encrypt', label: 'Encrypt', status: run.encrypted ? 'done' : 'skipped' },
    { id: 'upload', label: 'Upload', status: copies.length === 0 ? 'skipped' : anyFailed ? (allOk ? 'done' : 'failed') : 'done' },
    { id: 'verify', label: 'Verify', status: 'skipped', detail: 'not recorded for this backup' },
  ]
}

export function RunContents({ run, onClose }: { run: RunView | null; onClose: () => void }) {
  const load = useServerFn(getRunContents)
  const inspect = useServerFn(inspectRun)
  const router = useRouter()
  const { can } = useWorkspace()
  const { run: act, pending } = useAction()
  const [data, setData] = useState<Contents | null>(null)
  const [showAll, setShowAll] = useState(false)

  async function refresh(id: string) {
    setData(null)
    setData(await load({ data: { id } }))
  }
  useEffect(() => {
    setShowAll(false)
    if (run) void refresh(run.id)
  }, [run?.id])

  const m = data?.manifest
  const prev = data?.previous?.manifest
  const prevRows = new Map(prev?.tables.map((t) => [t.name, t.rows]))
  const removed = prev?.tables.filter((t) => !m?.tables.some((x) => x.name === t.name)) ?? []
  const totalRows = m?.tables.reduce((a, t) => a + t.rows, 0) ?? 0
  // Changed/new tables always show; unchanged ones (row count identical to the previous backup)
  // collapse behind "Show all" so a wide schema doesn't bury what actually moved.
  const changed = m?.tables.filter((t) => !prev || prevRows.get(t.name) !== t.rows) ?? []
  const unchanged = m?.tables.filter((t) => prev && prevRows.get(t.name) === t.rows) ?? []
  const visibleTables = showAll || !prev ? (m?.tables ?? []) : changed

  return (
    <Sheet open={run !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Backup contents</SheetTitle>
          <SheetDescription>
            {run && `${run.instance_name} · ${formatDate(run.started_at)} · ${formatBytes(run.bytes)}`}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {run && (
            <BreadcrumbTrail>
              <EntityChip kind="run" name={`Run ${run.id.slice(0, 7)}`} size="md" />
              {run.job_id && <EntityChip kind="job" name={run.job_name} to="/jobs" size="md" />}
              {run.instance_id && <EntityChip kind="instance" name={run.instance_name} to="/instances" size="md" />}
            </BreadcrumbTrail>
          )}
          {!data ? (
            <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : !m ? (
            <div className="space-y-3 rounded-md border p-4 text-sm">
              <p>This backup was made before contents were recorded.</p>
              {can('download') && (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => act(async () => { await inspect({ data: { id: run!.id } }); await refresh(run!.id); await router.invalidate() }, { success: 'Backup inspected' })}
                >
                  <FileSearch /> {pending ? 'Downloading & inspecting…' : 'Inspect now'}
                </Button>
              )}
            </div>
          ) : (
            <>
              {run && <PipelineSteps steps={deriveSteps(run)} />}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-md border p-3"><div className="text-xl font-semibold">{m.tables.length}</div><div className="text-muted-foreground text-xs">tables</div></div>
                <div className="rounded-md border p-3"><div className="text-xl font-semibold">{totalRows.toLocaleString()}</div><div className="text-muted-foreground text-xs">documents</div></div>
                <div className="rounded-md border p-3"><div className="text-xl font-semibold">{m.files.count.toLocaleString()}</div><div className="text-muted-foreground text-xs">files · {formatBytes(m.files.bytes)}</div></div>
              </div>
              <p className="text-muted-foreground text-xs">
                {data.previous ? `Changes compared with the backup of ${formatDate(data.previous.started_at)}.` : 'No earlier backup with contents to compare with.'}
                {m.convexVersion && m.convexVersion !== 'unknown' && ` Convex ${m.convexVersion}.`}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Table</TableHead>
                    <TableHead className="text-right">Documents</TableHead>
                    {prev && <TableHead className="text-right">Change</TableHead>}
                    <TableHead className="text-right">Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTables.map((t) => (
                    <TableRow key={t.name}>
                      <TableCell className="font-mono text-xs">{t.name}</TableCell>
                      <TableCell className="text-right">{t.rows.toLocaleString()}</TableCell>
                      {prev && <TableCell className="text-right"><Delta now={t.rows} before={prevRows.get(t.name)} /></TableCell>}
                      <TableCell className="text-muted-foreground text-right text-xs">{formatBytes(t.bytes)}</TableCell>
                    </TableRow>
                  ))}
                  {(showAll || !prev) &&
                    removed.map((t) => (
                      <TableRow key={`removed-${t.name}`} className="text-muted-foreground">
                        <TableCell className="font-mono text-xs line-through">{t.name}</TableCell>
                        <TableCell className="text-right line-through">0</TableCell>
                        <TableCell className="text-right"><Badge variant="outline" className="text-warning">removed</Badge></TableCell>
                        <TableCell />
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {prev && !showAll && (unchanged.length > 0 || removed.length > 0) && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {unchanged.length + removed.length} unchanged table{unchanged.length + removed.length === 1 ? '' : 's'} not shown
                  </span>
                  <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setShowAll(true)}>
                    Show all
                  </button>
                </div>
              )}
              {run?.sha256 && (
                <p className="text-muted-foreground flex items-center gap-1.5 text-xs break-all">
                  SHA-256 of the stored file: <code className="font-mono">{run.sha256}</code>
                </p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

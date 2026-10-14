import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ArrowDownRight, ArrowUpRight, FileSearch, Minus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet'
import { Skeleton } from '~/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatBytes, formatDate } from '~/lib/format'
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
    <span className={`inline-flex items-center gap-1 text-xs ${up ? 'text-emerald-600' : 'text-amber-600'}`}>
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {up ? '+' : ''}
      {d.toLocaleString()}
    </span>
  )
}

export function RunContents({ run, onClose }: { run: RunView | null; onClose: () => void }) {
  const load = useServerFn(getRunContents)
  const inspect = useServerFn(inspectRun)
  const router = useRouter()
  const { can } = useWorkspace()
  const { run: act, pending } = useAction()
  const [data, setData] = useState<Contents | null>(null)

  async function refresh(id: string) {
    setData(null)
    setData(await load({ data: { id } }))
  }
  useEffect(() => {
    if (run) void refresh(run.id)
  }, [run?.id])

  const m = data?.manifest
  const prev = data?.previous?.manifest
  const prevRows = new Map(prev?.tables.map((t) => [t.name, t.rows]))
  const removed = prev?.tables.filter((t) => !m?.tables.some((x) => x.name === t.name)) ?? []
  const totalRows = m?.tables.reduce((a, t) => a + t.rows, 0) ?? 0

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
                  {m.tables.map((t) => (
                    <TableRow key={t.name}>
                      <TableCell className="font-mono text-xs">{t.name}</TableCell>
                      <TableCell className="text-right">{t.rows.toLocaleString()}</TableCell>
                      {prev && <TableCell className="text-right"><Delta now={t.rows} before={prevRows.get(t.name)} /></TableCell>}
                      <TableCell className="text-muted-foreground text-right text-xs">{formatBytes(t.bytes)}</TableCell>
                    </TableRow>
                  ))}
                  {removed.map((t) => (
                    <TableRow key={`removed-${t.name}`} className="text-muted-foreground">
                      <TableCell className="font-mono text-xs line-through">{t.name}</TableCell>
                      <TableCell className="text-right">0</TableCell>
                      <TableCell className="text-right"><Badge variant="outline" className="text-amber-600">removed</Badge></TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {run?.sha256 && (
                <p className="text-muted-foreground text-xs break-all">
                  SHA-256 of the stored file: <code>{run.sha256}</code>
                </p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

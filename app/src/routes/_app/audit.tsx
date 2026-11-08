import { createFileRoute } from '@tanstack/react-router'
import { Check, Copy, Download, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageBody, PageHeader } from '~/components/page'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { EntityChip, StatusDot, type DotStatus, type EntityKind } from '~/components/viz'
import { formatDate } from '~/lib/format'
import { cn } from '~/lib/utils'
import { getAudit } from '~/server/fns'

export const Route = createFileRoute('/_app/audit')({
  loader: () => getAudit(),
  component: Audit,
})

/** Action strings are `entity.verb[_qualifier]`, e.g. "backup.completed", "workspace.scrub_rules_updated". */
function actionTone(action: string): DotStatus {
  if (/failed|revoked|revealed|deleted|removed|disabled/.test(action)) return 'danger'
  if (/started|restore/.test(action)) return 'warning'
  if (/completed|created|enabled(?!d)|restored|invited|rotated/.test(action)) return 'success'
  return 'info'
}

function entityKindFor(action: string): EntityKind | null {
  const prefix = action.split('.')[0]
  return prefix === 'instance' || prefix === 'job' || prefix === 'destination' ? (prefix as EntityKind) : null
}

function parseDetail(detail: string | null): Record<string, unknown> | null {
  if (!detail) return null
  try {
    const v = JSON.parse(detail) as unknown
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function Audit() {
  const { events } = Route.useLoaderData()
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.toLowerCase()
    return s ? events.filter((e) => `${e.actor} ${e.action} ${e.detail ?? ''}`.toLowerCase().includes(s)) : events
  }, [events, q])

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change, backup, restore and download — newest first (last 300 shown)."
        actions={<Button variant="outline" asChild><a href="/api/audit.csv"><Download /> Export CSV</a></Button>}
      />
      <PageBody>
        <div className="relative max-w-sm">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by user, action or detail…" className="pl-8" />
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => {
                const tone = actionTone(e.action)
                const kind = entityKindFor(e.action)
                const parsed = parseDetail(e.detail)
                const chipName = kind && typeof parsed?.name === 'string' ? parsed.name : null
                const label = e.action.replace(/\./g, ' ').replace(/_/g, ' ')
                return (
                  <TableRow key={e.id} className="h-10">
                    <TableCell className="pl-4 font-mono text-xs whitespace-nowrap">{formatDate(e.at)}</TableCell>
                    <TableCell className="text-sm">{e.actor === 'system' ? <span className="text-muted-foreground">system</span> : e.actor}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 text-sm">
                        <StatusDot status={tone} size="sm" />
                        {label}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xl">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {chipName && <EntityChip kind={kind!} name={chipName} size="sm" />}
                        {e.detail && <DetailValue detail={e.detail} />}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground py-8 text-center text-sm">
                    No events match “{q}”.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </PageBody>
    </>
  )
}

/** Truncated mono value that reveals its full text on hover and copies on click — used for the
 * JSON detail blob (ids, error messages, keys, urls) audit rows carry. */
function DetailValue({ detail }: { detail: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    await navigator.clipboard.writeText(detail)
    setCopied(true)
    toast.success('Copied to clipboard')
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      title={detail}
      className="group text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-1 truncate font-mono text-xs"
    >
      <span className="truncate">{detail}</span>
      <span className={cn('shrink-0 opacity-0 transition-opacity group-hover:opacity-100', copied && 'opacity-100')}>
        {copied ? <Check className="text-success size-3" /> : <Copy className="size-3" />}
      </span>
    </button>
  )
}

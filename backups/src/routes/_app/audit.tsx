import { createFileRoute } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageBody, PageHeader } from '~/components/page'
import { Badge } from '~/components/ui/badge'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatDate } from '~/lib/format'
import { getAudit } from '~/server/fns'

export const Route = createFileRoute('/_app/audit')({
  loader: () => getAudit(),
  component: Audit,
})

function tone(action: string) {
  if (/failed|deleted|revealed/.test(action)) return 'border-red-500/30 text-red-700 dark:text-red-400'
  if (/restore/.test(action)) return 'border-amber-500/30 text-amber-700 dark:text-amber-400'
  if (/completed|created/.test(action)) return 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
  return ''
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
      <PageHeader title="Audit log" description="Every change, backup, restore and download — newest first (last 300 events)." />
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
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDate(e.at)}</TableCell>
                  <TableCell className="text-sm">{e.actor}</TableCell>
                  <TableCell><Badge variant="outline" className={tone(e.action)}>{e.action}</Badge></TableCell>
                  <TableCell className="text-muted-foreground max-w-xl truncate font-mono text-xs" title={e.detail ?? ''}>{e.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </PageBody>
    </>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { HardDrive, Lock } from 'lucide-react'
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { PageBody, PageHeader } from '~/components/page'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '~/components/ui/chart'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { EntityChip } from '~/components/viz'
import { cn } from '~/lib/utils'
import { formatBytes, timeAgo } from '~/lib/format'
import { getStorage } from '~/server/fns'
import { getStorageRetention } from '~/server/storage-fns'

export const Route = createFileRoute('/_app/storage')({
  loader: async () => {
    const [storage, retention] = await Promise.all([getStorage(), getStorageRetention()])
    return { ...storage, tiers: retention.tiers }
  },
  component: Storage,
})

const money = (n: number) => (n < 0.01 && n > 0 ? '< $0.01' : `$${n.toFixed(2)}`)
// Distinct hues (the neutral theme's --chart-* colours are greys).
const PALETTE = ['oklch(0.62 0.19 255)', 'oklch(0.7 0.17 160)', 'oklch(0.75 0.16 70)', 'oklch(0.62 0.2 300)', 'oklch(0.65 0.21 20)']

function Storage() {
  const data = Route.useLoaderData()
  const [isolated, setIsolated] = useState<string | null>(null)
  const config = Object.fromEntries(data.destinations.map((d, i) => [`d${i}`, { label: d.name, color: PALETTE[i % PALETTE.length] }])) satisfies ChartConfig
  const series = data.series.map((p) => Object.fromEntries([['date', p.date], ...data.destinations.map((d, i) => [`d${i}`, p[d.id]])]))
  const first = data.series.find((p) => data.destinations.some((d) => Number(p[d.id]) > 0))
  const growth = first ? data.totals.bytes - data.destinations.reduce((a, d) => a + Number(first[d.id] ?? 0), 0) : 0
  const window = `${data.days} days`
  const visible = data.destinations.filter((_, i) => !isolated || isolated === `d${i}`)

  return (
    <>
      <PageHeader title="Storage" description="How much backup data each destination holds, how it's growing, and what it costs." />
      <PageBody>
        {data.destinations.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><HardDrive /></EmptyMedia>
              <EmptyTitle>No destinations yet</EmptyTitle>
              <EmptyDescription>Add a destination and run a backup to see usage here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card><CardHeader><CardDescription>Stored now</CardDescription><CardTitle className="text-2xl">{formatBytes(data.totals.bytes)}</CardTitle><p className="text-muted-foreground text-xs">{data.destinations.reduce((a, d) => a + d.objects, 0)} backups across {data.destinations.length} destinations</p></CardHeader></Card>
              <Card><CardHeader><CardDescription>Estimated cost / month</CardDescription><CardTitle className="text-2xl">{money(data.totals.monthly)}</CardTitle><p className="text-muted-foreground text-xs">Storage only, at list prices</p></CardHeader></Card>
              <Card><CardHeader><CardDescription>Growth ({window})</CardDescription><CardTitle className="text-2xl">{growth >= 0 ? '+' : '−'}{formatBytes(Math.abs(growth))}</CardTitle></CardHeader></Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Stored data, last {window}</CardTitle>
                <CardDescription>Per destination, after retention pruning. Click a destination below to isolate its series.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={config} className="aspect-auto h-64 w-full">
                  <AreaChart data={series} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                    <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatBytes(v)} />
                    <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v, name) => `${config[name as string]?.label ?? name}: ${formatBytes(Number(v))}`} />} />
                    {data.destinations.map((d, i) =>
                      !isolated || isolated === `d${i}` ? (
                        <Area key={d.id} dataKey={`d${i}`} type="stepAfter" stackId="a" fill={`var(--color-d${i})`} stroke={`var(--color-d${i})`} fillOpacity={0.3} isAnimationActive={false} />
                      ) : null,
                    )}
                  </AreaChart>
                </ChartContainer>
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.destinations.map((d, i) => {
                    const key = `d${i}`
                    const active = !isolated || isolated === key
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setIsolated(isolated === key ? null : key)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors',
                          active ? 'border-border bg-card' : 'border-border/50 bg-transparent opacity-50',
                        )}
                      >
                        <span className="block size-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden />
                        <span className="font-medium">{d.name}</span>
                        <span className="text-muted-foreground font-mono">{d.summary} · {formatBytes(d.bytes)}</span>
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Retention</CardTitle>
                <CardDescription>Backups each destination keeps per tier, newest on the left.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {data.destinations.map((d) => {
                  const t = data.tiers.find((x) => x.id === d.id)
                  const segments = [
                    { label: 'latest', n: t?.latest ?? 0, tone: 'bg-chart-1' },
                    { label: 'daily', n: t?.daily ?? 0, tone: 'bg-chart-2' },
                    { label: 'weekly', n: t?.weekly ?? 0, tone: 'bg-chart-3' },
                    { label: 'monthly', n: t?.monthly ?? 0, tone: 'bg-chart-5' },
                  ]
                  return (
                    <div key={d.id} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <EntityChip kind="destination" name={d.name} meta={d.summary} to="/destinations" size="sm" />
                        <span className="text-muted-foreground text-xs">{t?.kept ?? 0} backups kept</span>
                      </div>
                      <div className="flex gap-1.5">
                        {segments.map((s) => (
                          <div key={s.label} className="min-w-0 flex-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{s.label}</span>
                              <span className="font-mono tabular-nums">{s.n}</span>
                            </div>
                            <div className="bg-muted mt-1 flex h-1.5 gap-px overflow-hidden rounded-full">
                              {Array.from({ length: Math.max(1, Math.min(s.n, 12)) }, (_, i) => (
                                <div key={i} className={cn('h-full flex-1 rounded-full', i < s.n ? s.tone : 'bg-transparent')} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>By destination</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Destination</TableHead><TableHead className="text-right">Stored</TableHead><TableHead className="text-right">Backups</TableHead><TableHead className="text-right">$/month</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.destinations.map((d) => (
                        <TableRow key={d.id} className="h-10">
                          <TableCell>
                            <div className="flex items-center gap-2 font-medium">{d.name}{d.objectLock && <Lock className="text-success size-3" aria-label="Object Lock" />}</div>
                            <div className="text-muted-foreground font-mono text-xs">${d.price}/GB-month</div>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatBytes(d.bytes)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{d.objects}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{money(d.monthly)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>By instance</CardTitle><CardDescription>Across all destinations.</CardDescription></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Instance</TableHead><TableHead className="text-right">Stored</TableHead><TableHead className="text-right">Copies</TableHead><TableHead className="text-right">Latest</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.instances.map((i) => (
                        <TableRow key={i.name} className="h-10">
                          <TableCell className="font-medium">{i.name}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatBytes(i.bytes)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{i.objects}</TableCell>
                          <TableCell className="text-right text-sm">{timeAgo(i.latest)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
            <p className="text-muted-foreground text-xs">
              Costs are estimates from list prices or the price set on each destination, for storage only (no request or egress fees).{' '}
              <Badge variant="outline">local</Badge> volumes count as free.
              {visible.length !== data.destinations.length && ' Chart shows the isolated destination only.'}
            </p>
          </>
        )}
      </PageBody>
    </>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { HardDrive, Lock } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { PageBody, PageHeader } from '~/components/page'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '~/components/ui/chart'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatBytes, timeAgo } from '~/lib/format'
import { getStorage } from '~/server/fns'

export const Route = createFileRoute('/_app/storage')({
  loader: () => getStorage(),
  component: Storage,
})

const money = (n: number) => (n < 0.01 && n > 0 ? '< $0.01' : `$${n.toFixed(2)}`)

function Storage() {
  const data = Route.useLoaderData()
  // Distinct hues (the neutral theme's --chart-* colours are greys).
  const PALETTE = ['oklch(0.62 0.19 255)', 'oklch(0.7 0.17 160)', 'oklch(0.75 0.16 70)', 'oklch(0.62 0.2 300)', 'oklch(0.65 0.21 20)']
  const config = Object.fromEntries(data.destinations.map((d, i) => [`d${i}`, { label: d.name, color: PALETTE[i % PALETTE.length] }])) satisfies ChartConfig
  const series = data.series.map((p) => Object.fromEntries([['date', p.date], ...data.destinations.map((d, i) => [`d${i}`, p[d.id]])]))
  const first = data.series.find((p) => data.destinations.some((d) => Number(p[d.id]) > 0))
  const growth = first ? data.totals.bytes - data.destinations.reduce((a, d) => a + Number(first[d.id] ?? 0), 0) : 0
  const window = `${data.days} days`

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
              <Card><CardHeader><CardDescription>Stored now</CardDescription><CardTitle className="text-2xl">{formatBytes(data.totals.bytes)}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Estimated cost / month</CardDescription><CardTitle className="text-2xl">{money(data.totals.monthly)}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Growth ({window})</CardDescription><CardTitle className="text-2xl">{growth >= 0 ? '+' : '−'}{formatBytes(Math.abs(growth))}</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Stored data, last {window}</CardTitle>
                <CardDescription>Per destination, after retention pruning.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={config} className="aspect-auto h-64 w-full">
                  <AreaChart data={series} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                    <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatBytes(v)} />
                    <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v, name) => `${config[name as string]?.label ?? name}: ${formatBytes(Number(v))}`} />} />
                    {data.destinations.map((d, i) => (
                      <Area key={d.id} dataKey={`d${i}`} type="stepAfter" stackId="a" fill={`var(--color-d${i})`} stroke={`var(--color-d${i})`} fillOpacity={0.3} isAnimationActive={false} />
                    ))}
                    <ChartLegend content={<ChartLegendContent />} />
                  </AreaChart>
                </ChartContainer>
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
                        <TableRow key={d.id}>
                          <TableCell>
                            <div className="flex items-center gap-2 font-medium">{d.name}{d.objectLock && <Lock className="size-3 text-emerald-600" aria-label="Object Lock" />}</div>
                            <div className="text-muted-foreground text-xs">${d.price}/GB-month</div>
                          </TableCell>
                          <TableCell className="text-right">{formatBytes(d.bytes)}</TableCell>
                          <TableCell className="text-right">{d.objects}</TableCell>
                          <TableCell className="text-right">{money(d.monthly)}</TableCell>
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
                        <TableRow key={i.name}>
                          <TableCell className="font-medium">{i.name}</TableCell>
                          <TableCell className="text-right">{formatBytes(i.bytes)}</TableCell>
                          <TableCell className="text-right">{i.objects}</TableCell>
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
            </p>
          </>
        )}
      </PageBody>
    </>
  )
}

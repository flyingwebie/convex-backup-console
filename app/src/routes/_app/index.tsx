import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Archive, ArrowUpRight, Bell, CalendarClock, Database, HardDrive, KeyRound, Play, Server, ShieldAlert, TriangleAlert, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { InstanceKindBadge } from '~/components/instance-kind'
import { PageBody, PageHeader } from '~/components/page'
import { StatusBadge } from '~/components/status'
import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { BreadcrumbTrail, EntityChip, type DotStatus, TopologyMap, type TopologyEdge } from '~/components/viz'
import { formatBytes, timeAgo } from '~/lib/format'
import { useAction, usePolling } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { getOverview, runJobNow } from '~/server/fns'
import { getOverviewTopology } from '~/server/overview-fns'

export const Route = createFileRoute('/_app/')({
  loader: async () => {
    const [overview, topology] = await Promise.all([getOverview(), getOverviewTopology()])
    return { ...overview, edges: topology.edges }
  },
  component: Overview,
})

const runStatusDot = (s: 'ok' | 'partial' | 'failed' | 'running' | null): DotStatus =>
  s === 'ok' ? 'success' : s === 'partial' ? 'warning' : s === 'failed' ? 'danger' : s === 'running' ? 'running' : 'neutral'

/** Aggregate several edge healths into one node-corner dot: worst outcome wins, running beats all. */
function worstDot(healths: TopologyEdge['health'][]): DotStatus {
  if (healths.length === 0) return 'neutral'
  if (healths.includes('running')) return 'running'
  if (healths.includes('danger')) return 'danger'
  if (healths.every((h) => h === 'inactive')) return 'neutral'
  return 'success'
}

function Overview() {
  const data = Route.useLoaderData()
  const { can: allowed, settings } = useWorkspace()
  const STALE_MS = settings.stale_hours * 3_600_000
  const runNow = useServerFn(runJobNow)
  const { run, pending } = useAction()
  usePolling(data.runs.some((r) => r.status === 'running') || data.instances.some((i) => i.busy || i.restoring))

  if (data.instances.length === 0) {
    return (
      <>
        <PageHeader title="Overview" />
        <PageBody>
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Database /></EmptyMedia>
              <EmptyTitle>Let's protect your first Convex instance</EmptyTitle>
              <EmptyDescription>
                Add an instance (its API URL and admin key), a destination to store backups, then a job that ties them together.
              </EmptyDescription>
            </EmptyHeader>
            {allowed('manage') && (
              <EmptyContent className="flex-row justify-center gap-2">
                <Button asChild><Link to="/instances">Add instance</Link></Button>
                <Button variant="outline" asChild><Link to="/destinations">Add destination</Link></Button>
              </EmptyContent>
            )}
          </Empty>
        </PageBody>
      </>
    )
  }

  const unprotected = data.instances.filter((i) => !data.jobs.some((j) => j.instance_id === i.id && j.enabled))
  const stale = data.instances.filter(
    (i) => data.jobs.some((j) => j.instance_id === i.id) && (!i.last_ok_at || Date.now() - i.last_ok_at > STALE_MS),
  )
  const failing = data.instances.filter((i) => i.last_status === 'failed')
  const upcoming = data.jobs.filter((j) => j.next_run).sort((a, b) => a.next_run! - b.next_run!)[0]
  const instanceName = (id: string) => data.instances.find((i) => i.id === id)?.name ?? '—'
  const jobById = (id: string) => data.jobs.find((j) => j.id === id)

  // Topology nodes: status dot per node derived from the edges touching it, so the map stays
  // consistent with the alert cards/table below without a second source of truth.
  const instanceNodes = data.instances.map((i) => ({
    id: i.id,
    kind: 'instance' as const,
    title: i.name,
    subtitle: i.kind === 'cloud' ? 'Convex Cloud' : i.url.replace(/^https?:\/\//, ''),
    status: i.busy ? 'running' : runStatusDot(i.last_status as 'ok' | 'partial' | 'failed' | null),
    to: '/instances',
  }))
  const jobNodes = data.jobs.map((j) => ({
    id: j.id,
    kind: 'job' as const,
    title: j.name,
    subtitle: j.cron ? `cron ${j.cron}` : 'manual only',
    status: worstDot(data.edges.filter((e) => e.to === j.id).map((e) => e.health)),
    to: '/jobs',
  }))
  const destinationNodes = data.destinations.map((d) => ({
    id: d.id,
    kind: 'destination' as const,
    title: d.name,
    subtitle: d.summary,
    status: worstDot(data.edges.filter((e) => e.to === d.id).map((e) => e.health)),
    to: '/destinations',
  }))

  return (
    <>
      <PageHeader title="Overview" description="Health of every protected Convex instance at a glance." />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={Server} title="Instances" value={data.instances.length} hint={`${data.instances.length - unprotected.length} with an active job`} />
          <Stat
            icon={Archive}
            title="Backups (7 days)"
            value={data.stats.total}
            hint={`${data.stats.ok} ok · ${data.stats.partial} partial · ${data.stats.failed} failed`}
            tone={data.stats.failed ? 'bad' : undefined}
          />
          <Stat icon={Upload} title="Data backed up (7 days)" value={formatBytes(data.stats.bytes)} hint={`${data.destinations.length} destination${data.destinations.length === 1 ? '' : 's'}`} />
          <Stat
            icon={CalendarClock}
            title="Next scheduled backup"
            value={upcoming ? timeAgo(upcoming.next_run) : '—'}
            hint={upcoming ? `${upcoming.name} · ${instanceName(upcoming.instance_id)}` : 'No schedules yet'}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Topology</CardTitle>
            <CardDescription>Instances → jobs → destinations, colored by last-run health.</CardDescription>
            <CardAction>
              <div className="text-muted-foreground hidden items-center gap-3 text-xs sm:flex">
                <Legend color="bg-success" label="Succeeded" />
                <Legend color="bg-danger" label="Failed" />
                <Legend color="bg-running" label="Running" />
                <Legend color="bg-muted-foreground/40" label="No runs" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent>
            <TopologyMap instances={instanceNodes} jobs={jobNodes} destinations={destinationNodes} edges={data.edges} />
          </CardContent>
        </Card>

        {(failing.length > 0 || stale.length > 0 || unprotected.length > 0 || !data.encryption || data.channels === 0) && (
          <div className="grid gap-3 lg:grid-cols-2">
            {failing.length > 0 && (
              <AlertCard icon={ShieldAlert} status="danger" title="Last backup failed" href="/runs">
                {failing.map((i) => (
                  <EntityChip key={i.id} kind="instance" name={i.name} size="sm" />
                ))}
                <span className="text-muted-foreground">Check Runs for the error.</span>
              </AlertCard>
            )}
            {stale.length > 0 && (
              <AlertCard icon={TriangleAlert} status="warning" title={`No successful backup in the last ${settings.stale_hours} hours`} href="/instances">
                {stale.map((i) => (
                  <EntityChip key={i.id} kind="instance" name={i.name} size="sm" />
                ))}
              </AlertCard>
            )}
            {unprotected.length > 0 && (
              <AlertCard icon={Database} status="warning" title="Instances without an active job" href="/jobs">
                {unprotected.map((i) => (
                  <EntityChip key={i.id} kind="instance" name={i.name} size="sm" />
                ))}
                <span className="text-muted-foreground">has no job protecting it.</span>
              </AlertCard>
            )}
            {!data.encryption && (
              <AlertCard icon={KeyRound} status="info" title="Backups are not encrypted" href="/workspace">
                <span className="text-muted-foreground">Anyone with bucket access can read them.</span>
              </AlertCard>
            )}
            {data.channels === 0 && (
              <AlertCard icon={Bell} status="info" title="No failure alerts configured" href="/notifications">
                <span className="text-muted-foreground">A failing backup would go unnoticed.</span>
              </AlertCard>
            )}
          </div>
        )}

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Instances</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/instances">All instances <ArrowUpRight /></Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Instance</TableHead>
                  <TableHead>Last status</TableHead>
                  <TableHead>Last good backup</TableHead>
                  <TableHead>Jobs</TableHead>
                  <TableHead className="pr-6 text-right">Back up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.instances.map((i) => {
                  const jobs = data.jobs.filter((j) => j.instance_id === i.id)
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-2 font-medium">{i.name} <InstanceKindBadge kind={i.kind} type={i.deployment_type} /></div>
                        <div className="text-muted-foreground font-mono text-xs">{i.url}</div>
                      </TableCell>
                      <TableCell>
                        {i.busy ? <StatusBadge status="running" label="Backing up" /> : i.restoring ? <StatusBadge status="running" label="Restoring" /> : i.last_status ? <StatusBadge status={i.last_status} /> : <span className="text-muted-foreground text-sm">No backups yet</span>}
                      </TableCell>
                      <TableCell className={i.last_ok_at && Date.now() - i.last_ok_at > STALE_MS ? 'text-warning' : undefined}>
                        {timeAgo(i.last_ok_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{jobs.length ? jobs.map((j) => j.name).join(', ') : '—'}</TableCell>
                      <TableCell className="pr-6 text-right">
                        {jobs[0] && allowed('run') && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending || i.busy}
                            onClick={() => run(() => runNow({ data: { id: jobs[0].id } }), { success: `Backup of ${i.name} started` })}
                          >
                            <Play /> Run {jobs.length > 1 ? jobs[0].name : 'now'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest backup runs across all instances.</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/runs">All runs <ArrowUpRight /></Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
              {data.runs.length === 0 ? (
                <p className="text-muted-foreground text-sm">No runs yet.</p>
              ) : (
                <ul className="divide-y">
                  {data.runs.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <BreadcrumbTrail>
                          {r.job_id ? <EntityChip kind="job" name={r.job_name} size="sm" to="/jobs" /> : <span className="text-sm font-medium">{r.job_name}</span>}
                          <span aria-hidden className="text-muted-foreground text-xs">←</span>
                          {r.instance_id ? <EntityChip kind="instance" name={r.instance_name} size="sm" to="/instances" /> : <span className="text-sm">{r.instance_name}</span>}
                        </BreadcrumbTrail>
                        <div className="text-muted-foreground mt-1 truncate font-mono text-xs">
                          {r.id.slice(0, 8)} · {timeAgo(r.started_at)} · {formatBytes(r.bytes)}
                          {r.error && <span className="text-danger"> · {r.error}</span>}
                        </div>
                      </div>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

        <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
          <Link to="/destinations" className="flex items-center gap-1 hover:underline"><HardDrive className="size-3" /> {data.destinations.length} destinations</Link>
          <Link to="/notifications" className="flex items-center gap-1 hover:underline"><Bell className="size-3" /> {data.channels} alert channels</Link>
          <span className="flex items-center gap-1"><KeyRound className="size-3" /> encryption {data.encryption ? 'on' : 'off'}</span>
        </div>
      </PageBody>
    </>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`block size-1.5 rounded-full ${color}`} aria-hidden /> {label}
    </span>
  )
}

function Stat({ icon: Icon, title, value, hint, tone }: { icon: typeof Server; title: string; value: string | number; hint: string; tone?: 'bad' }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardDescription>{title}</CardDescription>
          <Icon className="text-muted-foreground size-4" aria-hidden />
        </div>
        <CardTitle className={tone === 'bad' ? 'text-danger text-2xl' : 'text-2xl'}>{value}</CardTitle>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardHeader>
    </Card>
  )
}

const ALERT_ICON_TONE: Record<'danger' | 'warning' | 'info', string> = {
  danger: 'bg-danger-muted text-danger',
  warning: 'bg-warning-muted text-warning',
  info: 'bg-info-muted text-info',
}

function AlertCard({
  icon: Icon,
  status,
  title,
  href,
  children,
}: {
  icon: typeof ShieldAlert
  status: 'danger' | 'warning' | 'info'
  title: string
  href: string
  children?: ReactNode
}) {
  return (
    <Link to={href} className="group border-border bg-card hover:border-ring flex items-start gap-3 rounded-lg border p-4 transition-colors">
      <div className={`flex size-8 shrink-0 items-center justify-center rounded-md ${ALERT_ICON_TONE[status]}`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{title}</span>
          <ArrowUpRight className="text-muted-foreground size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">{children}</div>
      </div>
    </Link>
  )
}

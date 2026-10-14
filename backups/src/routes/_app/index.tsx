import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ArrowRight, Bell, Database, HardDrive, KeyRound, Play, ShieldAlert, TriangleAlert } from 'lucide-react'
import { PageBody, PageHeader } from '~/components/page'
import { StatusBadge } from '~/components/status'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatBytes, timeAgo } from '~/lib/format'
import { useAction, usePolling } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { getOverview, runJobNow } from '~/server/fns'

export const Route = createFileRoute('/_app/')({
  loader: () => getOverview(),
  component: Overview,
})

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

  return (
    <>
      <PageHeader title="Overview" description="Health of every protected Convex instance at a glance." />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat title="Instances" value={data.instances.length} hint={`${data.instances.length - unprotected.length} with an active job`} />
          <Stat
            title="Backups (7 days)"
            value={data.stats.total}
            hint={`${data.stats.ok} ok · ${data.stats.partial} partial · ${data.stats.failed} failed`}
            tone={data.stats.failed ? 'bad' : undefined}
          />
          <Stat title="Data backed up (7 days)" value={formatBytes(data.stats.bytes)} hint={`${data.destinations.length} destination${data.destinations.length === 1 ? '' : 's'}`} />
          <Stat
            title="Next scheduled backup"
            value={upcoming ? timeAgo(upcoming.next_run) : '—'}
            hint={upcoming ? `${upcoming.name} · ${instanceName(upcoming.instance_id)}` : 'No schedules yet'}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {failing.length > 0 && (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertTitle>Last backup failed</AlertTitle>
              <AlertDescription>{failing.map((i) => i.name).join(', ')} — check Runs for the error.</AlertDescription>
            </Alert>
          )}
          {stale.length > 0 && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>No successful backup in the last {settings.stale_hours} hours</AlertTitle>
              <AlertDescription>{stale.map((i) => i.name).join(', ')}</AlertDescription>
            </Alert>
          )}
          {unprotected.length > 0 && (
            <Alert>
              <Database />
              <AlertTitle>Instances without an active job</AlertTitle>
              <AlertDescription>
                <span>{unprotected.map((i) => i.name).join(', ')} — <Link to="/jobs" className="underline">create a job</Link>.</span>
              </AlertDescription>
            </Alert>
          )}
          {!data.encryption && (
            <Alert>
              <KeyRound />
              <AlertTitle>Backups are not encrypted</AlertTitle>
              <AlertDescription>
                <span>Anyone with bucket access can read them. <Link to="/workspace" className="underline">Create an encryption key</Link>.</span>
              </AlertDescription>
            </Alert>
          )}
          {data.channels === 0 && (
            <Alert>
              <Bell />
              <AlertTitle>No failure alerts configured</AlertTitle>
              <AlertDescription>
                <span>A failing backup would go unnoticed. <Link to="/notifications" className="underline">Add a channel</Link>.</span>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Instances</CardTitle>
            <CardDescription>Last successful backup and next scheduled run for each instance.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Instance</TableHead>
                  <TableHead>Last status</TableHead>
                  <TableHead>Last good backup</TableHead>
                  <TableHead>Jobs</TableHead>
                  <TableHead className="text-right">Back up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.instances.map((i) => {
                  const jobs = data.jobs.filter((j) => j.instance_id === i.id)
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="font-medium">{i.name}</div>
                        <div className="text-muted-foreground text-xs">{i.url}</div>
                      </TableCell>
                      <TableCell>
                        {i.busy ? <StatusBadge status="running" label="Backing up" /> : i.restoring ? <StatusBadge status="running" label="Restoring" /> : i.last_status ? <StatusBadge status={i.last_status} /> : <span className="text-muted-foreground text-sm">No backups yet</span>}
                      </TableCell>
                      <TableCell className={i.last_ok_at && Date.now() - i.last_ok_at > STALE_MS ? 'text-amber-600' : undefined}>
                        {timeAgo(i.last_ok_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{jobs.length ? jobs.map((j) => j.name).join(', ') : '—'}</TableCell>
                      <TableCell className="text-right">
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
                <Link to="/runs">All runs <ArrowRight /></Link>
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
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.instance_name} · {r.job_name}</div>
                      <div className="text-muted-foreground truncate text-xs">
                        {timeAgo(r.started_at)} · {r.trigger.startsWith('manual') ? 'manual' : 'scheduled'} · {formatBytes(r.bytes)}
                        {r.error && <span className="text-destructive"> · {r.error}</span>}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <div className="text-muted-foreground flex gap-4 text-xs">
          <Link to="/destinations" className="flex items-center gap-1 hover:underline"><HardDrive className="size-3" /> {data.destinations.length} destinations</Link>
          <Link to="/notifications" className="flex items-center gap-1 hover:underline"><Bell className="size-3" /> {data.channels} alert channels</Link>
          <span className="flex items-center gap-1"><KeyRound className="size-3" /> encryption {data.encryption ? 'on' : 'off'}</span>
        </div>
      </PageBody>
    </>
  )
}

function Stat({ title, value, hint, tone }: { title: string; value: string | number; hint: string; tone?: 'bad' }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className={tone === 'bad' ? 'text-destructive text-2xl' : 'text-2xl'}>{value}</CardTitle>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardHeader>
    </Card>
  )
}

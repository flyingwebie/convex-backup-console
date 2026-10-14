import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CalendarClock, History, Lock, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Confirm } from '~/components/confirm'
import { PageBody, PageHeader } from '~/components/page'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { CRON_PRESETS, describeCron, describeRetention, timeAgo } from '~/lib/format'
import { useAction, usePolling } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { addJob, deleteJob, getJobs, runJobNow, setJobEnabled, updateJob, type JobView } from '~/server/fns'

export const Route = createFileRoute('/_app/jobs')({
  loader: () => getJobs(),
  component: Jobs,
})

type Data = Awaited<ReturnType<typeof getJobs>>

function Jobs() {
  const data = Route.useLoaderData()
  const [editing, setEditing] = useState<JobView | 'new' | null>(null)
  const runNow = useServerFn(runJobNow)
  const toggle = useServerFn(setJobEnabled)
  const del = useServerFn(deleteJob)
  const { run, pending } = useAction()
  usePolling(data.instances.some((i) => i.busy))
  const { can: allowed } = useWorkspace()
  const instance = (id: string) => data.instances.find((i) => i.id === id)
  const dest = (id: string) => data.destinations.find((d) => d.id === id)?.name ?? '?'
  const ready = data.instances.length > 0 && data.destinations.length > 0

  return (
    <>
      <PageHeader
        title="Jobs"
        description="A job backs up one instance to one or more destinations, manually or on a schedule."
        actions={allowed('manage') && <Button disabled={!ready} onClick={() => setEditing('new')}><Plus /> New job</Button>}
      />
      <PageBody>
        {data.jobs.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><CalendarClock /></EmptyMedia>
              <EmptyTitle>No backup jobs yet</EmptyTitle>
              <EmptyDescription>
                {ready ? 'Create a job to start backing up an instance.' : 'Add at least one instance and one destination first.'}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {!allowed('manage') ? null : ready ? (
                <Button onClick={() => setEditing('new')}><Plus /> New job</Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" asChild><Link to="/instances">Instances</Link></Button>
                  <Button variant="outline" asChild><Link to="/destinations">Destinations</Link></Button>
                </div>
              )}
            </EmptyContent>
          </Empty>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Job</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Destinations</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.map((j) => {
                  const inst = instance(j.instance_id)
                  return (
                    <TableRow key={j.id}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2 font-medium">
                          {j.name}
                          {j.encrypt && <Lock className="text-muted-foreground size-3.5" aria-label="Encrypted" />}
                        </div>
                        <div className="text-muted-foreground text-xs">{inst?.name}{!j.include_storage && ' · data only, no files'}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{describeCron(j.cron)}{j.cron && <span className="text-muted-foreground text-xs"> · {data.timezone}</span>}</div>
                        {j.next_run && <div className="text-muted-foreground text-xs">next {timeAgo(j.next_run)}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{describeRetention(j)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {j.destination_ids.map((d) => <Badge key={d} variant="secondary">{dest(d)}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={j.enabled}
                          disabled={!j.cron || !allowed('manage')}
                          aria-label="Schedule active"
                          onCheckedChange={(enabled) => run(() => toggle({ data: { id: j.id, enabled } }), { success: enabled ? 'Schedule resumed' : 'Schedule paused' })}
                        />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <div className="flex justify-end gap-1">
                          {allowed('run') && <Button size="sm" variant="outline" disabled={pending || inst?.busy} onClick={() => run(() => runNow({ data: { id: j.id } }), { success: `${j.name} started` })}>
                            <Play /> Run
                          </Button>}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Actions"><MoreHorizontal /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {allowed('manage') && <DropdownMenuItem onClick={() => setEditing(j)}><Pencil /> Edit</DropdownMenuItem>}
                              <DropdownMenuItem asChild>
                                <Link to="/runs" search={{ job: j.id }}><History /> Run history</Link>
                              </DropdownMenuItem>
                              {allowed('manage') && (
                                <>
                                  <DropdownMenuSeparator />
                                  <Confirm
                                    trigger={<DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}><Trash2 /> Move to trash</DropdownMenuItem>}
                                    title={`Delete ${j.name}?`}
                                    description="The schedule stops and the job moves to the Trash. Its backups stay restorable from Runs."
                                    action="Move to trash"
                                    onConfirm={() => run(() => del({ data: { id: j.id } }), { success: 'Job moved to trash' })}
                                  />
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </PageBody>
      <JobDialog data={data} job={editing} onClose={() => setEditing(null)} />
    </>
  )
}


function JobDialog({ data, job, onClose }: { data: Data; job: JobView | 'new' | null; onClose: () => void }) {
  if (job === null) return null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <JobForm data={data} job={job === 'new' ? null : job} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function JobForm({ data, job, onClose }: { data: Data; job: JobView | null; onClose: () => void }) {
  const add = useServerFn(addJob)
  const update = useServerFn(updateJob)
  const { run, pending } = useAction()
  const n = (v: number | null | undefined) => (v ? String(v) : '')
  const d = data.defaults
  const RECOMMENDED = { keepLast: n(d.keepLast), keepDaily: n(d.keepDaily), keepWeekly: n(d.keepWeekly), keepMonthly: n(d.keepMonthly) }
  const [name, setName] = useState(job?.name ?? 'Daily backup')
  const [instanceId, setInstanceId] = useState(job?.instance_id ?? data.instances[0]?.id ?? '')
  const [destinationIds, setDestinationIds] = useState<string[]>(job?.destination_ids ?? data.destinations.map((d) => d.id).slice(0, 1))
  const [preset, setPreset] = useState(job ? (job.cron ? (CRON_PRESETS.some(([c]) => c === job.cron) ? job.cron : 'custom') : 'manual') : '0 3 * * *')
  const [customCron, setCustomCron] = useState(job?.cron ?? '')
  const [keepVals, setKeep] = useState(
    job ? { keepLast: n(job.keep_last), keepDaily: n(job.keep_daily), keepWeekly: n(job.keep_weekly), keepMonthly: n(job.keep_monthly) } : RECOMMENDED,
  )
  const [includeStorage, setIncludeStorage] = useState(job?.include_storage ?? d.includeStorage)
  const [encrypt, setEncrypt] = useState(job?.encrypt ?? (data.encryption && d.encrypt))
  const num = (v: string) => (v ? Number(v) : null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      name,
      instanceId,
      destinationIds,
      includeStorage,
      encrypt,
      cron: preset === 'manual' ? '' : preset === 'custom' ? customCron : preset,
      keepLast: num(keepVals.keepLast),
      keepDaily: num(keepVals.keepDaily),
      keepWeekly: num(keepVals.keepWeekly),
      keepMonthly: num(keepVals.keepMonthly),
    }
    const ok = job
      ? await run(() => update({ data: { id: job.id, ...payload } }).then(() => true), { success: 'Job saved' })
      : await run(() => add({ data: payload }), { success: 'Job created' })
    if (ok) onClose()
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{job ? `Edit ${job.name}` : 'New backup job'}</DialogTitle>
        <DialogDescription>Each run exports the instance, then uploads the archive to every selected destination.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="py-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="job-name">Name</FieldLabel>
            <Input id="job-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field>
            <FieldLabel>Instance</FieldLabel>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {data.instances.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <FieldSet>
          <FieldLegend variant="label">Destinations</FieldLegend>
          <FieldDescription>Pick at least one off-site destination.</FieldDescription>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.destinations.map((d) => (
              <Field key={d.id} orientation="horizontal" className="rounded-md border p-3">
                <Checkbox
                  id={`dest-${d.id}`}
                  checked={destinationIds.includes(d.id)}
                  onCheckedChange={(v) => setDestinationIds((ids) => (v ? [...ids, d.id] : ids.filter((x) => x !== d.id)))}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`dest-${d.id}`}>{d.name}</FieldLabel>
                  <FieldDescription className="truncate text-xs">{d.kind === 's3' ? d.summary : `local · ${d.summary}`}</FieldDescription>
                </FieldContent>
              </Field>
            ))}
          </div>
        </FieldSet>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>Schedule</FieldLabel>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual only</SelectItem>
                {CRON_PRESETS.map(([cron, label]) => <SelectItem key={cron} value={cron}>{label}</SelectItem>)}
                <SelectItem value="custom">Custom cron…</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {preset === 'custom' && (
            <Field>
              <FieldLabel htmlFor="cron">Cron expression ({data.timezone})</FieldLabel>
              <Input id="cron" value={customCron} onChange={(e) => setCustomCron(e.target.value)} placeholder="30 2 * * 1-5" className="font-mono" required />
            </Field>
          )}
        </div>

        <FieldSet>
          <div className="flex items-center justify-between">
            <FieldLegend variant="label">Retention (per destination)</FieldLegend>
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setKeep(RECOMMENDED)}>
              Use workspace defaults
            </Button>
          </div>
          <FieldDescription>
            Daily / weekly / monthly keep the newest backup of each of the last N days, weeks or months. Empty = no limit. All empty keeps everything.
          </FieldDescription>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['keepLast', 'Latest'],
                ['keepDaily', 'Daily'],
                ['keepWeekly', 'Weekly'],
                ['keepMonthly', 'Monthly'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k}>
                <FieldLabel htmlFor={k}>{label}</FieldLabel>
                <Input id={k} type="number" min={1} value={keepVals[k]} onChange={(e) => setKeep((s) => ({ ...s, [k]: e.target.value }))} placeholder="—" />
              </Field>
            ))}
          </div>
        </FieldSet>

        <Field orientation="horizontal" className="rounded-md border p-3">
          <FieldContent>
            <FieldLabel htmlFor="encrypt">Encrypt archives (age)</FieldLabel>
            <FieldDescription>
              {data.encryption ? 'Archives are encrypted before upload; the console decrypts them for restore and download.' : (
                <>Create an encryption key in <Link to="/workspace" className="underline">Workspace settings</Link> first.</>
              )}
            </FieldDescription>
          </FieldContent>
          <Switch id="encrypt" checked={encrypt} disabled={!data.encryption} onCheckedChange={setEncrypt} />
        </Field>
        <Field orientation="horizontal" className="rounded-md border p-3">
          <FieldContent>
            <FieldLabel htmlFor="storage">Include file storage</FieldLabel>
            <FieldDescription>Back up files stored with <code>ctx.storage</code>, not just documents.</FieldDescription>
          </FieldContent>
          <Switch id="storage" checked={includeStorage} onCheckedChange={setIncludeStorage} />
        </Field>
      </FieldGroup>
      <DialogFooter className="bg-background sticky -bottom-4 z-10">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={pending || destinationIds.length === 0}>{job ? 'Save job' : 'Create job'}</Button>
      </DialogFooter>
    </form>
  )
}

import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CalendarClock, Database, HardDrive, RotateCcw, Trash2 } from 'lucide-react'
import { Confirm } from '~/components/confirm'
import { PageBody, PageHeader } from '~/components/page'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatDate, purgeSummary, timeAgo } from '~/lib/format'
import { useAction } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { getTrash, purgeNow, restoreFromTrash } from '~/server/fns'


export const Route = createFileRoute('/_app/trash')({
  loader: () => getTrash(),
  component: Trash,
})

const ICON = { instance: Database, job: CalendarClock, destination: HardDrive } as const

function Trash() {
  const data = Route.useLoaderData()
  const { can } = useWorkspace()
  const restore = useServerFn(restoreFromTrash)
  const purge = useServerFn(purgeNow)
  const { run, pending } = useAction()

  return (
    <>
      <PageHeader title="Trash" description="Deleted instances, jobs and destinations. Restore them before the grace period ends." />
      <PageBody>
        <Alert>
          <Trash2 />
          <AlertTitle>
            Items are purged {data.trash_days === 0 ? 'immediately' : `${data.trash_days} day${data.trash_days === 1 ? '' : 's'} after deletion`}
          </AlertTitle>
          <AlertDescription>
            <span>
              {purgeSummary(data.purge_remote, data.purge_local)}{' '}
              {can('settings') && <Link to="/workspace" className="underline">Change the deletion policy</Link>}
            </span>
          </AlertDescription>
        </Alert>
        {data.items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Trash2 /></EmptyMedia>
              <EmptyTitle>Trash is empty</EmptyTitle>
              <EmptyDescription>Deleted items appear here and can be restored.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Item</TableHead>
                  <TableHead>Deleted</TableHead>
                  <TableHead>Purged</TableHead>
                  <TableHead className="w-56" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((i) => {
                  const Icon = ICON[i.kind]
                  return (
                    <TableRow key={`${i.kind}-${i.id}`}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2 font-medium"><Icon className="text-muted-foreground size-4" /> {i.name}</div>
                        <div className="mt-1 flex gap-1">
                          <Badge variant="secondary" className="capitalize">{i.kind}</Badge>
                          {i.parent && <Badge variant="outline">with {i.parent}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(i.deleted_at)}</TableCell>
                      <TableCell className="text-sm">{timeAgo(i.purge_at)}</TableCell>
                      <TableCell className="pr-4 text-right">
                        <div className="flex justify-end gap-1">
                          {can('manage') && !i.parent && (
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => restore({ data: { kind: i.kind, id: i.id } }), { success: `${i.name} restored` })}>
                              <RotateCcw /> Restore
                            </Button>
                          )}
                          {can('purge') && !i.parent && (
                            <Confirm
                              trigger={<Button size="sm" variant="ghost" className="text-destructive">Delete now</Button>}
                              title={`Permanently delete ${i.name}?`}
                              description={
                                i.kind === 'destination'
                                  ? 'This cannot be undone. Backup files already stored in it are kept.'
                                  : `This cannot be undone. ${purgeSummary(data.purge_remote, data.purge_local, 'Its')}`
                              }
                              action="Delete permanently"
                              onConfirm={() => run(() => purge({ data: { kind: i.kind, id: i.id } }), { success: `${i.name} permanently deleted` })}
                            />
                          )}
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
    </>
  )
}

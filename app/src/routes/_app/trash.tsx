import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Clock, RotateCcw, Trash2 } from 'lucide-react'
import { Confirm } from '~/components/confirm'
import { PageBody, PageHeader } from '~/components/page'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { ENTITY_ICON, ENTITY_TINT } from '~/components/viz'
import { formatDate, purgeSummary, timeAgo } from '~/lib/format'
import { useAction } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { getTrash, purgeNow, restoreFromTrash } from '~/server/fns'

export const Route = createFileRoute('/_app/trash')({
  loader: () => getTrash(),
  component: Trash,
})

function Trash() {
  const data = Route.useLoaderData()
  const { can } = useWorkspace()
  const restore = useServerFn(restoreFromTrash)
  const purge = useServerFn(purgeNow)
  const { run, pending } = useAction()
  const soonest = data.items.length ? Math.min(...data.items.map((i) => i.purge_at)) : null
  const purgingSoon = soonest != null && soonest - Date.now() < 48 * 3_600_000

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
              {data.items.length > 0 && purgingSoon && <span className="text-warning font-medium">{data.items.filter((i) => i.purge_at - Date.now() < 48 * 3_600_000).length} item(s) purge within 48 hours. </span>}
              {purgeSummary(data)}{' '}
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
                  const Icon = ENTITY_ICON[i.kind]
                  const tint = ENTITY_TINT[i.kind]
                  const purgingSoonRow = i.purge_at - Date.now() < 48 * 3_600_000
                  return (
                    <TableRow key={`${i.kind}-${i.id}`}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <div className={`flex size-8 shrink-0 items-center justify-center rounded-md ${tint.bg} ${tint.fg}`}>
                            <Icon className="size-4" />
                          </div>
                          <div>
                            <div className="font-medium">{i.name}</div>
                            <div className="mt-1 flex gap-1">
                              <Badge variant="secondary" className="capitalize">{i.kind}</Badge>
                              {i.parent && <Badge variant="outline">with {i.parent}</Badge>}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(i.deleted_at)}</TableCell>
                      <TableCell className="text-sm">
                        <span className={purgingSoonRow ? 'text-warning flex items-center gap-1 font-medium' : undefined}>
                          {purgingSoonRow && <Clock className="size-3" />}
                          {timeAgo(i.purge_at)}
                        </span>
                        <div className="text-muted-foreground font-mono text-xs">{formatDate(i.purge_at)}</div>
                      </TableCell>
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
                                  : `This cannot be undone. ${purgeSummary(data, 'Its')}`
                              }
                              action="Delete permanently"
                              onConfirm={() => run(() => purge({ data: { kind: i.kind, id: i.id } }), { success: `${i.name} permanently deleted` })}
                            />
                          )}
                          {i.parent && <span className="text-muted-foreground self-center text-xs">Restores with parent</span>}
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

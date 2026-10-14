import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Bell, Mail, MessageSquare, Plus, Send, Trash2, Webhook } from 'lucide-react'
import { useState } from 'react'
import { Confirm } from '~/components/confirm'
import { PageBody, PageHeader } from '~/components/page'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { useAction } from '~/lib/use-action'
import { useWorkspace } from '~/lib/use-workspace'
import { addChannel, deleteChannel, getChannels, setChannelEvents, testChannel } from '~/server/fns'

export const Route = createFileRoute('/_app/notifications')({
  loader: () => getChannels(),
  component: Notifications,
})

const KINDS = {
  discord: { label: 'Discord', icon: MessageSquare, hint: 'Server Settings → Integrations → Webhooks → New Webhook → Copy URL.' },
  slack: { label: 'Slack', icon: MessageSquare, hint: 'Create an Incoming Webhook in your Slack app and paste its URL.' },
  telegram: { label: 'Telegram', icon: Send, hint: 'Create a bot with @BotFather; get the chat ID by messaging the bot and opening getUpdates.' },
  email: { label: 'Email (SMTP)', icon: Mail, hint: 'Any SMTP server — Postmark, Resend, SES, Mailgun, Gmail app password…' },
  webhook: { label: 'Generic webhook', icon: Webhook, hint: 'POSTs a JSON event: { type, status, title, details, console, at }.' },
} as const
type Kind = keyof typeof KINDS

function Notifications() {
  const { channels } = Route.useLoaderData()
  const [open, setOpen] = useState(false)
  const test = useServerFn(testChannel)
  const setEvents = useServerFn(setChannelEvents)
  const del = useServerFn(deleteChannel)
  const { run } = useAction()
  const { can: allowed } = useWorkspace()
  const manage = allowed('manage')

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Get told when a backup or restore fails — or, optionally, when it succeeds."
        actions={manage && <Button onClick={() => setOpen(true)}><Plus /> Add channel</Button>}
      />
      <PageBody>
        {channels.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Bell /></EmptyMedia>
              <EmptyTitle>No channels yet</EmptyTitle>
              <EmptyDescription>Without alerts, a failing nightly backup can go unnoticed for weeks.</EmptyDescription>
            </EmptyHeader>
            {manage && <EmptyContent><Button onClick={() => setOpen(true)}><Plus /> Add channel</Button></EmptyContent>}
          </Empty>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Channel</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>On failure</TableHead>
                  <TableHead>On success</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((c) => {
                  const K = KINDS[c.kind as Kind]
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="pl-4">
                        <div className="font-medium">{c.name}</div>
                        <Badge variant="secondary" className="mt-1 gap-1"><K.icon className="size-3" />{K.label}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{c.target}</TableCell>
                      <TableCell>
                        <Switch disabled={!manage} checked={c.on_failure} aria-label="Notify on failure" onCheckedChange={(v) => run(() => setEvents({ data: { id: c.id, onFailure: v, onSuccess: c.on_success } }))} />
                      </TableCell>
                      <TableCell>
                        <Switch disabled={!manage} checked={c.on_success} aria-label="Notify on success" onCheckedChange={(v) => run(() => setEvents({ data: { id: c.id, onFailure: c.on_failure, onSuccess: v } }))} />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {manage && <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => run(() => test({ data: { id: c.id } }), { success: `Test sent to ${c.name}` })}>
                            <Send /> Test
                          </Button>
                          <Confirm
                            trigger={<Button size="icon" variant="ghost" aria-label="Delete"><Trash2 /></Button>}
                            title={`Delete ${c.name}?`}
                            description="You will no longer receive alerts on this channel."
                            onConfirm={() => run(() => del({ data: { id: c.id } }), { success: 'Channel deleted' })}
                          />
                        </div>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </PageBody>
      {open && <ChannelDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function ChannelDialog({ onClose }: { onClose: () => void }) {
  const add = useServerFn(addChannel)
  const { run, pending } = useAction()
  const [kind, setKind] = useState<Kind>('discord')
  const [onSuccess, setOnSuccess] = useState(false)
  const [secure, setSecure] = useState(false)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
            const config =
              kind === 'telegram'
                ? { kind, botToken: f.botToken, chatId: f.chatId }
                : kind === 'email'
                  ? { kind, host: f.host, port: Number(f.port), secure, user: f.user || undefined, pass: f.pass || undefined, from: f.from, to: f.to }
                  : { kind, url: f.url }
            const ok = await run(() => add({ data: { name: f.name, onFailure: true, onSuccess, config } }), { success: 'Channel added — use Test to check it' })
            if (ok) onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>Add notification channel</DialogTitle>
            <DialogDescription>{KINDS[kind].hint}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Type</FieldLabel>
                <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="c-name">Name</FieldLabel>
                <Input id="c-name" name="name" defaultValue={`${KINDS[kind].label} alerts`} key={kind} required />
              </Field>
            </div>
            {(kind === 'discord' || kind === 'slack' || kind === 'webhook') && (
              <Field>
                <FieldLabel htmlFor="url">Webhook URL</FieldLabel>
                <Input id="url" name="url" type="url" required autoComplete="off" placeholder={kind === 'discord' ? 'https://discord.com/api/webhooks/…' : kind === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://example.com/hooks/backups'} />
                <FieldDescription>Stored encrypted — webhook URLs are secrets.</FieldDescription>
              </Field>
            )}
            {kind === 'telegram' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="botToken">Bot token</FieldLabel>
                  <Input id="botToken" name="botToken" type="password" required autoComplete="off" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="chatId">Chat ID</FieldLabel>
                  <Input id="chatId" name="chatId" required placeholder="-1001234567890" />
                </Field>
              </div>
            )}
            {kind === 'email' && (
              <>
                <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
                  <Field>
                    <FieldLabel htmlFor="host">SMTP host</FieldLabel>
                    <Input id="host" name="host" required placeholder="smtp.postmarkapp.com" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="port">Port</FieldLabel>
                    <Input id="port" name="port" type="number" defaultValue={587} required />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="user">Username</FieldLabel>
                    <Input id="user" name="user" autoComplete="off" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="pass">Password</FieldLabel>
                    <Input id="pass" name="pass" type="password" autoComplete="off" />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="from">From</FieldLabel>
                    <Input id="from" name="from" required placeholder="backups@example.com" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="to">To</FieldLabel>
                    <Input id="to" name="to" required placeholder="ops@example.com" />
                  </Field>
                </div>
                <Field orientation="horizontal">
                  <Checkbox id="secure" checked={secure} onCheckedChange={(v) => setSecure(v === true)} />
                  <FieldLabel htmlFor="secure" className="font-normal">Use TLS from the start (port 465)</FieldLabel>
                </Field>
              </>
            )}
            <Field orientation="horizontal">
              <Checkbox id="onSuccess" checked={onSuccess} onCheckedChange={(v) => setOnSuccess(v === true)} />
              <FieldLabel htmlFor="onSuccess" className="font-normal">Also notify on success (failures are always sent)</FieldLabel>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>Add channel</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

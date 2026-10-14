import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Copy, Download, Eye, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageBody, PageHeader } from '~/components/page'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { authClient } from '~/lib/auth-client'
import { useAction } from '~/lib/use-action'
import { createEncryption, getEncryption, revealEncryptionKey } from '~/server/fns'

export const Route = createFileRoute('/_app/settings')({
  loader: () => getEncryption(),
  component: Settings,
})

function Settings() {
  const { recipient } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  return (
    <>
      <PageHeader title="Settings" description="Backup encryption and your account security." />
      <PageBody>
        <EncryptionCard recipient={recipient} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Two-factor authentication</CardTitle>
              <CardDescription>Required for every account on this console.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-sm">
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" variant="outline">Enabled</Badge>
              for {user.email}
            </CardContent>
          </Card>
          <PasswordCard />
        </div>
      </PageBody>
    </>
  )
}

function KeyBox({ identity, recipient }: { identity: string; recipient: string }) {
  const file = `# Convex Backup Console age key\n# public key: ${recipient}\n${identity}\n`
  return (
    <div className="space-y-3">
      <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">{identity}</pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(identity).then(() => toast.success('Private key copied'))}>
          <Copy /> Copy
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(file)}`} download="convex-backups-age-key.txt"><Download /> Download key file</a>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Recover without the console: <code>age -d -i convex-backups-age-key.txt backup.zip.age &gt; backup.zip</code>
      </p>
    </div>
  )
}

function EncryptionCard({ recipient }: { recipient: string | null }) {
  const create = useServerFn(createEncryption)
  const reveal = useServerFn(revealEncryptionKey)
  const { run, pending } = useAction()
  const [shown, setShown] = useState<{ identity: string; recipient: string } | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Backup encryption</CardTitle>
        <CardDescription>
          Archives are encrypted with <a className="underline" href="https://age-encryption.org" target="_blank" rel="noreferrer">age</a> before
          they leave this server, so a leaked bucket doesn't leak your data. Turn it on per job.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recipient ? (
          <>
            <Field>
              <FieldLabel>Public key (recipient)</FieldLabel>
              <code className="bg-muted block overflow-x-auto rounded-md p-2 text-xs">{recipient}</code>
            </Field>
            <Alert>
              <TriangleAlert />
              <AlertTitle>Keep a copy of the private key outside this server</AlertTitle>
              <AlertDescription>
                The console stores it encrypted with <code>BACKUP_MASTER_KEY</code>. If you lose both the server and the key, encrypted backups can't be recovered.
              </AlertDescription>
            </Alert>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">No key yet. Backups are stored as plain zip files.</p>
        )}
      </CardContent>
      <CardFooter>
        {recipient ? (
          <Button variant="outline" disabled={pending} onClick={async () => { const r = await run(() => reveal()); if (r) setShown({ identity: r.identity, recipient }) }}>
            <Eye /> Reveal private key
          </Button>
        ) : (
          <Button disabled={pending} onClick={async () => { const r = await run(() => create(), { success: 'Encryption key created' }); if (r) setShown(r) }}>
            <KeyRound /> Create encryption key
          </Button>
        )}
      </CardFooter>
      <Dialog open={shown !== null} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Save your private key</DialogTitle>
            <DialogDescription>Store it in your password manager now. It's the only way to decrypt backups without this console.</DialogDescription>
          </DialogHeader>
          {shown && <KeyBox identity={shown.identity} recipient={shown.recipient} />}
          <DialogFooter><Button onClick={() => setShown(null)}>I've saved it</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function PasswordCard() {
  const [pending, setPending] = useState(false)
  return (
    <Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          if (f.get('newPassword') !== f.get('confirm')) return toast.error('Passwords do not match')
          setPending(true)
          const res = await authClient.changePassword({
            currentPassword: String(f.get('currentPassword')),
            newPassword: String(f.get('newPassword')),
            revokeOtherSessions: true,
          })
          setPending(false)
          if (res.error) return toast.error(res.error.message ?? 'Could not change password')
          toast.success('Password changed — other sessions were signed out')
          form.reset()
        }}
      >
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Signs out every other session.</CardDescription>
        </CardHeader>
        <CardContent className="py-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="newPassword">New password</FieldLabel>
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
              <FieldDescription>At least 12 characters.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter><Button type="submit" disabled={pending}>Change password</Button></CardFooter>
      </form>
    </Card>
  )
}

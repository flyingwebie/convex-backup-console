import { createFileRoute } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageBody, PageHeader } from '~/components/page'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { authClient } from '~/lib/auth-client'
import { ROLE_INFO } from '~/lib/permissions'

export const Route = createFileRoute('/_app/account')({ component: Account })

function Account() {
  const { app } = Route.useRouteContext()
  return (
    <>
      <PageHeader title="Account & security" description={app.user.email} />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Two-factor authentication</CardTitle>
              <CardDescription>Required for every account on this console.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Enabled</Badge>
              <div>
                <div className="text-muted-foreground mb-1 text-xs">Your workspaces</div>
                <ul className="space-y-1">
                  {app.workspaces.map((w) => (
                    <li key={w.id} className="flex justify-between"><span>{w.name}</span><span className="text-muted-foreground">{ROLE_INFO[w.role].label}</span></li>
                  ))}
                  {app.user.isPlatformAdmin && <li className="flex justify-between"><span>Platform</span><span className="text-muted-foreground">Admin</span></li>}
                </ul>
              </div>
            </CardContent>
          </Card>
          <PasswordCard />
        </div>
      </PageBody>
    </>
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

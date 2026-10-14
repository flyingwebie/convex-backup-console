import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { useAction } from '~/lib/use-action'
import { createWorkspace } from '~/server/fns'

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useServerFn(createWorkspace)
  const router = useRouter()
  const { run, pending } = useAction()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [touched, setTouched] = useState(false)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const ok = await run(() => create({ data: { name, slug } }), { success: `Workspace "${name}" created` })
            if (ok) {
              onClose()
              setName('')
              setSlug('')
              setTouched(false)
              await router.navigate({ to: '/workspace' })
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>A separate space with its own instances, destinations, alerts, encryption key and members.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-6">
            <Field>
              <FieldLabel htmlFor="ws-name">Name</FieldLabel>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (!touched) setSlug(slugify(e.target.value))
                }}
                placeholder="Acme Corp"
                required
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ws-slug">Slug</FieldLabel>
              <Input id="ws-slug" value={slug} onChange={(e) => { setTouched(true); setSlug(e.target.value) }} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
              <FieldDescription>Lowercase letters, numbers and dashes. Used as an identifier.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending || !name || !slug}>Create workspace</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

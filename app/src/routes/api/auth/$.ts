import { createFileRoute } from '@tanstack/react-router'
import { auth } from '~/server/auth.server'
import { ensureBooted } from '~/server/boot.server'

async function handle({ request }: { request: Request }) {
  await ensureBooted()
  return auth().handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: handle, POST: handle } },
})

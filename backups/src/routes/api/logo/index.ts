import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'
import { auth } from '~/server/auth.server'
import { audit } from '~/server/db.server'
import { env } from '~/server/env.server'
import { requireWorkspace } from '~/server/workspace.server'

const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' }
const MAX = 512 * 1024

async function setLogo(request: Request, file: File | null) {
  const ctx = await requireWorkspace('settings')
  const dir = path.join(env.dataDir, 'logos')
  fs.mkdirSync(dir, { recursive: true })
  for (const ext of Object.values(TYPES)) fs.rmSync(path.join(dir, `${ctx.ws.id}.${ext}`), { force: true })
  let logo: string | null = null
  if (file) {
    fs.writeFileSync(path.join(dir, `${ctx.ws.id}.${TYPES[file.type]}`), Buffer.from(await file.arrayBuffer()))
    logo = `/api/logo/${ctx.ws.id}?v=${Date.now()}`
  }
  await auth().api.updateOrganization({ headers: request.headers, body: { organizationId: ctx.ws.id, data: { logo: logo ?? '' } } })
  audit(ctx.ws.id, ctx.user.email, file ? 'workspace.logo_updated' : 'workspace.logo_removed')
  return Response.json({ logo })
}

// POST multipart { file } — upload the active workspace's logo. DELETE — remove it.
export const Route = createFileRoute('/api/logo/')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const file = (await request.formData()).get('file')
          if (!(file instanceof File)) return Response.json({ error: 'No file' }, { status: 400 })
          if (!TYPES[file.type]) return Response.json({ error: 'Use PNG, JPG, SVG or WebP' }, { status: 400 })
          if (file.size > MAX) return Response.json({ error: 'Logo must be 512 KB or smaller' }, { status: 400 })
          return await setLogo(request, file)
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 })
        }
      },
      DELETE: async ({ request }) => {
        try {
          return await setLogo(request, null)
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 })
        }
      },
    },
  },
})

import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'
import { ensureBooted } from '~/server/boot.server'
import { env } from '~/server/env.server'

// Workspace logos are public (they appear on invitation pages before sign-in).
export const Route = createFileRoute('/api/logo/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        await ensureBooted()
        const dir = path.join(env.dataDir, 'logos')
        if (!/^[A-Za-z0-9_-]+$/.test(params.id)) return new Response('Not found', { status: 404 })
        for (const [ext, type] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['svg', 'image/svg+xml'], ['webp', 'image/webp']] as const) {
          const file = path.join(dir, `${params.id}.${ext}`)
          if (!fs.existsSync(file)) continue
          return new Response(fs.readFileSync(file), {
            headers: {
              'Content-Type': type,
              'Cache-Control': 'public, max-age=300',
              // SVGs can carry scripts; never let them run.
              'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
              'X-Content-Type-Options': 'nosniff',
            },
          })
        }
        return new Response('Not found', { status: 404 })
      },
    },
  },
})

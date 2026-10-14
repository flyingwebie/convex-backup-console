import { createFileRoute } from '@tanstack/react-router'
import { Readable } from 'node:stream'
import { audit, db } from '~/server/db.server'
import { decryptStream } from '~/server/encryption.server'
import { openDestination, type DestinationRow } from '~/server/storage.server'
import { requireWorkspace } from '~/server/workspace.server'

// GET /api/download?run=<runId>&dest=<destinationId>[&raw=1] — streams a stored backup zip.
export const Route = createFileRoute('/api/download')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await requireWorkspace('download').catch(() => null)
        if (!ctx) return new Response('Unauthorized', { status: 401 })
        const url = new URL(request.url)
        const copy = db()
          .prepare(
            `SELECT c.object_key FROM run_copies c JOIN runs r ON r.id = c.run_id
             WHERE c.run_id = ? AND c.destination_id = ? AND c.status = 'ok' AND c.deleted_at IS NULL AND r.workspace_id = ?`,
          )
          .get(url.searchParams.get('run'), url.searchParams.get('dest'), ctx.ws.id) as { object_key: string } | undefined
        if (!copy) return new Response('Not found', { status: 404 })
        const dest = db().prepare('SELECT * FROM destinations WHERE id = ?').get(url.searchParams.get('dest')) as DestinationRow
        const encrypted = copy.object_key.endsWith('.age')
        // ?raw=1 returns the encrypted .age file as stored; otherwise encrypted copies are decrypted.
        const raw = encrypted && url.searchParams.get('raw') === '1'
        const source = await openDestination(dest).get(copy.object_key)
        const stream = encrypted && !raw ? await decryptStream(ctx.ws.id, source) : source
        const filename = (raw ? copy.object_key : copy.object_key.replace(/\.age$/, '')).replaceAll('/', '_')
        audit(ctx.ws.id, ctx.user.email, 'backup.downloaded', { key: copy.object_key, destination: dest.name, raw })
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          headers: {
            'Content-Type': raw ? 'application/octet-stream' : 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})

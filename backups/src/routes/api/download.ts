import { createFileRoute } from '@tanstack/react-router'
import { Readable } from 'node:stream'
import { auth } from '~/server/auth.server'
import { ensureBooted } from '~/server/boot.server'
import { audit, db } from '~/server/db.server'
import { decryptStream } from '~/server/encryption.server'
import { openDestination, type DestinationRow } from '~/server/storage.server'

// GET /api/download?run=<runId>&dest=<destinationId> — streams a stored backup zip.
export const Route = createFileRoute('/api/download')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureBooted()
        const session = await auth().api.getSession({ headers: request.headers })
        if (!session?.user.twoFactorEnabled) return new Response('Unauthorized', { status: 401 })
        const url = new URL(request.url)
        const copy = db()
          .prepare(
            "SELECT object_key FROM run_copies WHERE run_id = ? AND destination_id = ? AND status = 'ok' AND deleted_at IS NULL",
          )
          .get(url.searchParams.get('run'), url.searchParams.get('dest')) as { object_key: string } | undefined
        if (!copy) return new Response('Not found', { status: 404 })
        const dest = db().prepare('SELECT * FROM destinations WHERE id = ?').get(url.searchParams.get('dest')) as DestinationRow
        const encrypted = copy.object_key.endsWith('.age')
        // ?raw=1 returns the encrypted .age file as stored; otherwise encrypted copies are decrypted.
        const raw = encrypted && url.searchParams.get('raw') === '1'
        const source = await openDestination(dest).get(copy.object_key)
        const stream = encrypted && !raw ? await decryptStream(source) : source
        const filename = (raw ? copy.object_key : copy.object_key.replace(/\.age$/, '')).replaceAll('/', '_')
        audit(session.user.email, 'backup.downloaded', { key: copy.object_key, destination: dest.name, raw })
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

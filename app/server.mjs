// Production entry: serves built client assets and hands everything else to TanStack Start.
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import app from './dist/server/server.js'

serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST ?? '0.0.0.0',
  middleware: [staticMiddleware({ dir: new URL('./dist/client', import.meta.url).pathname })],
  fetch: (request) => app.fetch(request),
})

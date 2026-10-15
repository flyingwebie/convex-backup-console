// Minimal stand-in for api.convex.dev's /api/deployment/url_for_key, for local Cloud tests.
// docker run -d --name cbc-bigbrain --network cbc-net -v "$PWD":/m node:22-alpine node /m/mock-convex-api.mjs
import http from 'node:http'

const TARGET = process.env.TARGET_URL ?? 'http://host.docker.internal:3301'
http
  .createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url !== '/api/deployment/url_for_key') return res.writeHead(404).end()
      const key = JSON.parse(body || '{}').deployKey ?? ''
      if (!key.startsWith('prod:self-hosted-convex|')) {
        return res.writeHead(401).end(JSON.stringify({ code: 'AuthenticationFailed', message: 'Invalid Convex deploy key' }))
      }
      res.end(JSON.stringify(TARGET))
    })
  })
  .listen(8080)

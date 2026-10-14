// Seeds a console database with realistic, fake demo data for screenshots.
// Usage: docker exec -i <container> env MASTER_KEY=... node - < seed-demo.cjs
const crypto = require('node:crypto')
const db = require('/app/node_modules/better-sqlite3')('/data/console.db')

const key = crypto.createHash('sha256').update(process.env.MASTER_KEY).digest()
const encrypt = (text) => {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
}
const id = () => crypto.randomUUID()
const DAY = 86_400_000
const now = Date.now()
const iso = (t) => new Date(t).toISOString()
let seed = 42
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

const ws = db.prepare('SELECT o.id FROM organization o ORDER BY createdAt LIMIT 1').get().id
const admin = db.prepare("SELECT id, email FROM user WHERE role = 'admin' LIMIT 1").get()
db.prepare("UPDATE organization SET name = 'Acme Agency', slug = 'acme-agency' WHERE id = ?").run(ws)
db.prepare("UPDATE user SET name = 'Davide Rossi' WHERE id = ?").run(admin.id)
db.prepare(`UPDATE workspace_settings SET timezone = 'Europe/Dublin', description = 'Client production apps managed by Acme',
  age_recipient = 'age1q2w0nl6e7hlhkhmmw5v4n3e5f2g0vq7p0mczg8k7k5n0xkp3fq9s8rtk5h', status_token = 'demo-status-token',
  digest = 'daily', digest_recipients = 'ops@acme.dev', trash_days = 14, stale_hours = 192 WHERE workspace_id = ?`).run(ws)

// Second workspace for the switcher
const ws2 = id()
db.prepare('INSERT INTO organization (id, name, slug, logo, createdAt) VALUES (?, ?, ?, NULL, ?)').run(ws2, 'Northwind Traders', 'northwind', iso(now - 40 * DAY))
db.prepare('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run(id(), ws2, admin.id, 'owner', iso(now - 40 * DAY))
db.prepare('INSERT INTO workspace_settings (workspace_id) VALUES (?)').run(ws2)

// Team members
for (const [name, email, role, days] of [
  ['Maya Chen', 'maya@acme.dev', 'admin', 80],
  ['Tom Walsh', 'tom@acme.dev', 'operator', 45],
  ['Client Viewer', 'it@shopco.com', 'viewer', 12],
]) {
  const uid = id()
  db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role, twoFactorEnabled) VALUES (?, ?, ?, 1, ?, ?, ?, 1)').run(uid, name, email, iso(now - days * DAY), iso(now - days * DAY), 'user')
  db.prepare('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run(id(), ws, uid, role, iso(now - days * DAY))
}
db.prepare("INSERT INTO invitation (id, organizationId, email, role, status, expiresAt, createdAt, inviterId) VALUES (?, ?, ?, 'operator', 'pending', ?, ?, ?)").run(id(), ws, 'sam@acme.dev', iso(now + 5 * DAY), iso(now - 2 * DAY), admin.id)

// Instances
const inst = {}
for (const [name, kind, url, depName, depType, ageDays] of [
  ['shop-prod', 'cloud', 'https://happy-otter-123.convex.cloud', 'happy-otter-123', 'prod', 95],
  ['shop-staging', 'cloud', 'https://quiet-fox-456.convex.cloud', 'quiet-fox-456', 'dev', 95],
  ['crm-prod', 'self_hosted', 'https://crm-api.acme.dev', null, null, 95],
  ['analytics', 'self_hosted', 'https://analytics-api.acme.dev', null, null, 60],
]) {
  inst[name] = id()
  db.prepare('INSERT INTO instances (id, workspace_id, name, url, admin_key_enc, kind, deployment_name, deployment_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(inst[name], ws, name, url, encrypt('demo'), kind, depName, depType, now - ageDays * DAY)
}

// Destinations
const dest = {}
for (const [name, kind, cfg] of [
  ['Cloudflare R2 · EU', 's3', { endpoint: 'https://9f2c.r2.cloudflarestorage.com', region: 'auto', bucket: 'acme-convex-backups', prefix: 'convex', accessKeyId: 'r2-demo' }],
  ['Backblaze B2 · immutable', 's3', { endpoint: 'https://s3.eu-central-003.backblazeb2.com', region: 'eu-central-003', bucket: 'acme-convex-locked', accessKeyId: 'b2-demo', objectLock: { mode: 'COMPLIANCE', days: 30 } }],
  ['Local vault', 'local', { root: '/data/backups' }],
]) {
  dest[name] = id()
  db.prepare('INSERT INTO destinations (id, workspace_id, name, kind, config, secret_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(dest[name], ws, name, kind, JSON.stringify(cfg), kind === 's3' ? encrypt('demo') : null, now - 95 * DAY)
}

// Jobs
const jobs = [
  { name: 'Nightly production', instance: 'shop-prod', dests: ['Cloudflare R2 · EU', 'Backblaze B2 · immutable'], cron: '0 3 * * *', size: 1.9e9, growth: 6e6, keep: [null, 7, 4, 12] },
  { name: 'Nightly', instance: 'crm-prod', dests: ['Cloudflare R2 · EU'], cron: '0 2 * * *', size: 640e6, growth: 1.5e6, keep: [null, 7, 4, 12] },
  { name: 'Weekly', instance: 'analytics', dests: ['Cloudflare R2 · EU', 'Local vault'], cron: '0 4 * * 0', size: 4.2e9, growth: 20e6, keep: [4, null, null, null], weekly: true, from: 60 },
  { name: 'Before releases', instance: 'shop-staging', dests: ['Cloudflare R2 · EU'], cron: null, size: 310e6, growth: 0, keep: [5, null, null, null] },
]
const tables = (scale) => [
  ['users', 48210], ['orders', 186402], ['order_items', 512330], ['products', 3120], ['carts', 9214], ['payments', 171882], ['sessions', 22071], ['events', 1840221],
].map(([n, r]) => ({ name: n, rows: Math.round(r * scale), bytes: Math.round(r * scale * 410) }))
for (const j of jobs) {
  const jobId = id()
  db.prepare(`INSERT INTO jobs (id, workspace_id, name, instance_id, include_storage, encrypt, cron, keep_last, keep_daily, keep_weekly, keep_monthly, enabled, created_at)
    VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, 1, ?)`).run(jobId, ws, j.name, inst[j.instance], j.cron, ...j.keep, now - 95 * DAY)
  for (const d of j.dests) db.prepare('INSERT INTO job_destinations (job_id, destination_id) VALUES (?, ?)').run(jobId, dest[d])
  const days = j.from ?? 90
  for (let d = days; d >= 0; d--) {
    if (j.weekly && new Date(now - d * DAY).getUTCDay() !== 0) continue
    if (!j.cron && (d + 7) % 9 !== 0) continue
    const started = now - d * DAY - (j.cron ? 3 * 3600_000 * rand() + 1800_000 : 0) - (d === 0 ? 0 : 0)
    if (started > now - 600_000) continue
    const failed = (d === 23 || d === 61) && j.instance === 'crm-prod'
    const partial = d === 9 && j.instance === 'shop-prod'
    const bytes = Math.round(j.size + (days - d) * j.growth * (0.9 + rand() * 0.2))
    const runId = id()
    const scale = (j.size / 1.9e9) * (1 + (days - d) * 0.0025)
    db.prepare(`INSERT INTO runs (id, workspace_id, job_id, instance_id, trigger, status, started_at, finished_at, bytes, error, encrypted, manifest, sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
      runId, ws, jobId, inst[j.instance], j.cron ? 'schedule' : 'api:github-actions', failed ? 'failed' : partial ? 'partial' : 'ok', started,
      started + (failed ? 4000 : 60_000 + bytes / 2e6), failed ? null : bytes,
      failed ? 'Cannot reach https://crm-api.acme.dev: ECONNREFUSED' : null,
      failed ? null : JSON.stringify({ tables: tables(scale), files: { count: Math.round(8400 * scale), bytes: Math.round(bytes * 0.35) }, convexVersion: '1.48.0' }),
      failed ? null : crypto.randomBytes(32).toString('hex'),
    )
    if (failed) continue
    j.dests.forEach((name, i) => {
      const pruned = d > 7 && !(new Date(now - d * DAY).getUTCDay() === 0 && d <= 28) && new Date(now - d * DAY).getUTCDate() !== 1
      const copyFailed = partial && i === 1
      const locked = name.includes('immutable') ? started + 30 * DAY : null
      db.prepare('INSERT INTO run_copies (run_id, destination_id, object_key, status, error, deleted_at, locked_until) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        runId, dest[name], `${j.instance}/${iso(started).replace(/[:.]/g, '-')}.zip.age`, copyFailed ? 'failed' : 'ok', copyFailed ? 'SlowDown: Please reduce your request rate.' : null,
        pruned && !(locked && locked > now) && !copyFailed ? started + 8 * DAY : null, locked,
      )
    })
  }
}

// Restores
const lastShop = db.prepare('SELECT id, started_at FROM runs WHERE instance_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1').get(inst['shop-prod'], 'ok')
for (const [target, mode, status, rows, tablesJson, scrubbed, ago, actor] of [
  ['shop-staging', 'replaceAll', 'ok', 2793452, null, 1, 0.2, 'maya@acme.dev'],
  ['crm-prod', 'replace', 'ok', 186402, '["orders"]', 0, 6, admin.email],
  ['shop-staging', 'replaceAll', 'ok', 2741230, null, 1, 21, 'maya@acme.dev'],
]) {
  db.prepare(`INSERT INTO restores (id, workspace_id, run_id, destination_id, object_key, target_instance_id, target_name, mode, actor, status, rows_written, started_at, finished_at, tables, scrubbed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id(), ws, lastShop.id, dest['Cloudflare R2 · EU'], `shop-prod/${iso(now - ago * DAY).replace(/[:.]/g, '-')}.zip.age`,
    inst[target], target, mode, actor, status, rows, now - ago * DAY, now - ago * DAY + 240_000, tablesJson, scrubbed)
}

// Alert channels
for (const [name, kind, cfg, fail, ok] of [
  ['#ops-alerts', 'slack', { kind: 'slack', url: 'https://hooks.slack.com/services/T000/B000/xxxx' }, 1, 0],
  ['Ops email', 'email', { kind: 'email', host: 'smtp.postmarkapp.com', port: 587, secure: false, from: 'backups@acme.dev', to: 'ops@acme.dev' }, 1, 1],
  ['Discord #infra', 'discord', { kind: 'discord', url: 'https://discord.com/api/webhooks/1/abc' }, 1, 0],
]) db.prepare('INSERT INTO channels (id, workspace_id, name, kind, config_enc, on_failure, on_success, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id(), ws, name, kind, encrypt(JSON.stringify(cfg)), fail, ok, now - 80 * DAY)

// Scrubbing rules + API token
db.prepare('UPDATE workspace_settings SET scrub_rules = ? WHERE workspace_id = ?').run(JSON.stringify([
  { table: '*', field: 'email', method: 'email' }, { table: 'users', field: 'name', method: 'name' }, { table: 'users', field: 'phone', method: 'phone' }, { table: 'orders', field: 'shippingAddress', method: 'redact' },
]), ws)
db.prepare("INSERT INTO api_tokens (id, workspace_id, name, prefix, hash, scope, created_by, created_at, expires_at, last_used_at) VALUES (?, ?, 'github-actions-shop', 'Xk2pQa', 'x', 'run', ?, ?, ?, ?)").run(id(), ws, admin.email, now - 30 * DAY, now + 335 * DAY, now - 9 * DAY)

// Audit trail
const events = [
  [0.01, 'maya@acme.dev', 'restore.completed', { target: 'shop-staging', scrubbed: true }],
  [0.2, 'maya@acme.dev', 'restore.started', { target: 'shop-staging', mode: 'replaceAll', scrub: true }],
  [0.4, 'system', 'backup.completed', { instance: 'shop-prod', status: 'ok' }],
  [1, 'tom@acme.dev', 'backup.downloaded', { key: 'crm-prod/…zip.age' }],
  [2, admin.email, 'member.invited', { email: 'sam@acme.dev', role: 'operator' }],
  [6, admin.email, 'restore.started', { target: 'crm-prod', tables: ['orders'] }],
  [9, 'api:github-actions-shop', 'backup.started', { job: 'Before releases' }],
  [12, admin.email, 'member.invited', { email: 'it@shopco.com', role: 'viewer' }],
  [23, 'system', 'backup.failed', { instance: 'crm-prod', error: 'ECONNREFUSED' }],
  [30, admin.email, 'api_token.created', { name: 'github-actions-shop', scope: 'run' }],
  [45, admin.email, 'destination.created', { name: 'Backblaze B2 · immutable', objectLock: 'COMPLIANCE 30d' }],
]
for (const [ago, actor, action, detail] of events) db.prepare('INSERT INTO audit (workspace_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)').run(ws, now - ago * DAY, actor, action, JSON.stringify(detail))

console.log('demo data seeded:', db.prepare('SELECT COUNT(*) n FROM runs').get().n, 'runs')

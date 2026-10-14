import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { env } from './env.server'

const g = globalThis as { __db?: Database.Database }

export function db(): Database.Database {
  if (g.__db) return g.__db
  fs.mkdirSync(env.dataDir, { recursive: true })
  const conn = new Database(path.join(env.dataDir, 'console.db'))
  conn.pragma('journal_mode = WAL')
  conn.pragma('foreign_keys = ON')
  conn.exec(SCHEMA)
  migrate(conn)
  g.__db = conn
  return conn
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  admin_key_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('s3', 'local')),
  config TEXT NOT NULL,
  secret_enc TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  include_storage INTEGER NOT NULL DEFAULT 1,
  cron TEXT,
  keep_last INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS job_destinations (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, destination_id)
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  instance_id TEXT REFERENCES instances(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  bytes INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS run_copies (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  deleted_at INTEGER,
  PRIMARY KEY (run_id, destination_id)
);
CREATE TABLE IF NOT EXISTS restores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  target_instance_id TEXT REFERENCES instances(id) ON DELETE SET NULL,
  target_name TEXT NOT NULL,
  mode TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL,
  confirm_message TEXT,
  rows_written INTEGER,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  config_enc TEXT NOT NULL,
  on_failure INTEGER NOT NULL DEFAULT 1,
  on_success INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id TEXT PRIMARY KEY,
  description TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  default_keep_last INTEGER,
  default_keep_daily INTEGER DEFAULT 7,
  default_keep_weekly INTEGER DEFAULT 4,
  default_keep_monthly INTEGER DEFAULT 12,
  default_encrypt INTEGER NOT NULL DEFAULT 1,
  default_include_storage INTEGER NOT NULL DEFAULT 1,
  stale_hours INTEGER NOT NULL DEFAULT 26,
  trash_days INTEGER NOT NULL DEFAULT 7,
  purge_backups INTEGER NOT NULL DEFAULT 0,
  age_recipient TEXT,
  age_identity_enc TEXT,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
`

export function audit(workspaceId: string | null, actor: string, action: string, detail?: unknown) {
  db()
    .prepare('INSERT INTO audit (workspace_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(workspaceId, Date.now(), actor, action, detail === undefined ? null : JSON.stringify(detail))
}

/** Migrations for databases created by earlier versions. Idempotent. */
function migrate(conn: Database.Database) {
  const cols = (table: string) => (conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
  const add = (table: string, column: string, ddl: string) => {
    if (!cols(table).includes(column)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
  add('jobs', 'keep_daily', 'INTEGER')
  add('jobs', 'keep_weekly', 'INTEGER')
  add('jobs', 'keep_monthly', 'INTEGER')
  add('jobs', 'encrypt', 'INTEGER NOT NULL DEFAULT 0')
  add('runs', 'encrypted', 'INTEGER NOT NULL DEFAULT 0')

  // v2: names were globally UNIQUE; workspaces need per-workspace uniqueness. Rebuild those tables.
  for (const table of ['instances', 'destinations']) {
    const sql = (conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string }).sql
    if (!/name TEXT NOT NULL UNIQUE/.test(sql)) continue
    conn.pragma('foreign_keys = OFF')
    // SQLite's recommended rebuild: create new → copy → drop old → rename new (keeps other tables' FKs intact).
    conn.transaction(() => {
      const ddl = SCHEMA.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\);`))![0]
      conn.exec(ddl.replace(`IF NOT EXISTS ${table} (`, `${table}_new (`))
      const shared = cols(table).filter((c) => cols(`${table}_new`).includes(c)).join(', ')
      conn.exec(`INSERT INTO ${table}_new (${shared}) SELECT ${shared} FROM ${table}`)
      conn.exec(`DROP TABLE ${table}`)
      conn.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`)
    })()
    conn.pragma('foreign_keys = ON')
  }

  for (const table of ['instances', 'destinations', 'jobs', 'channels', 'runs', 'restores', 'audit']) add(table, 'workspace_id', 'TEXT')
  for (const table of ['instances', 'destinations', 'jobs']) add(table, 'deleted_at', 'INTEGER')
  // Convex Cloud support: kind = 'self_hosted' | 'cloud'; cloud instances keep the deployment name/type from the deploy key.
  add('instances', 'kind', "TEXT NOT NULL DEFAULT 'self_hosted'")
  add('instances', 'deployment_name', 'TEXT')
  add('instances', 'deployment_type', 'TEXT')
  conn.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS instances_ws_name ON instances (workspace_id, name) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS destinations_ws_name ON destinations (workspace_id, name) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS runs_ws ON runs (workspace_id, started_at);
    CREATE INDEX IF NOT EXISTS audit_ws ON audit (workspace_id, id);
  `)
}

export function getSetting(key: string): string | null {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value || null
}

export function setSetting(key: string, value: string) {
  db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

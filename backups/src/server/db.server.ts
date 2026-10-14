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
  g.__db = conn
  return conn
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  admin_key_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
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
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
`

export function audit(actor: string, action: string, detail?: unknown) {
  db()
    .prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)')
    .run(Date.now(), actor, action, detail === undefined ? null : JSON.stringify(detail))
}

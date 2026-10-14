# Convex Backup Console — Plan

One shared, password-protected console that backs up and restores **many** self-hosted Convex
instances (each deployed from this repo's root `docker-compose.yaml`). Deployed **separately**
in Coolify from `backups/docker-compose.yaml`. Replaces `orenaksakal/convex-self-hosted-backups`.

## Why build (not adopt)

- `orenaksakal/convex-self-hosted-backups`: no restore, no UI, one instance per container.
- `KodyDennon/ConvexAutoBackup` (beta.7): good design, but **cannot target self-hosted Convex**
  — only cloud targets can be created, and it drives the CLI via `CONVEX_DEPLOY_KEY`, which
  resolves URLs through Convex Cloud. Every remaining gap would also be Rust work in someone
  else's codebase. We borrow its ideas (manifests, typed restore confirmation, audit log, GFS).
- Running the console *inside* Convex is rejected: a `ReplaceAll` restore would overwrite the
  console's own state, and a dead instance would take its recovery tool down with it.

## Architecture

- **One container**: TanStack Start (Node) + in-process scheduler + SQLite (Drizzle) on a `/data` volume.
- **Auth**: Better Auth — email+password, sign-up disabled, first admin seeded from env, TOTP 2FA.
- **Exposure**: no Coolify domain. `cloudflared` sidecar (Cloudflare Tunnel) → `backups.<domain>`,
  guarded by Cloudflare Access (fixed email list, email PIN, 24h session). No public origin route.
- **Secrets**: instance admin keys and destination credentials encrypted at rest (AES-256-GCM)
  with `BACKUP_MASTER_KEY`. Archives encrypted with **age** (key exported once to a password manager).
- **Images**: GitHub Actions → `ghcr.io/flyingwebie/convex-backup-console` (amd64), tagged by version + SHA.

## Convex API usage (direct HTTP, admin key, no CLI)

| Step | Endpoint |
|---|---|
| Start export | `POST /api/export/request/zip?includeStorage=true` (409 = already running) |
| Wait | poll `_system/cli/exports:getLatest` until `completed`/`failed` |
| Download | `GET /api/export/zip/{id}` (streamed) |
| Clean source | `POST /api/export/set_expiration/{id}` after all copies succeed |
| Import | `start_upload` → `upload_part` (≥5 MiB) → `finish_upload` → poll `queryImport` → `perform_import` |

Streaming: download → age encrypt → fan-out multipart uploads; never buffer whole archives in memory.

## v1 scope

1. Instances: name, API URL, admin key, "test connection".
2. Destinations: S3-compatible (AWS S3, R2, B2, MinIO/RustFS) and local volume.
3. Jobs: instance → N destinations, manual run + cron, include file storage, GFS retention
   (keep-last/daily/weekly/monthly) per destination.
4. Restore: same or different instance, modes `ReplaceAll` (default) / `Replace` / `Append` /
   `RequireEmpty`; typed confirmation (instance name); surfaces schema-conflict pause.
5. Streamed, decrypted zip download.
6. Run history, audit log, notifications (webhook, Discord, Slack, Telegram, SMTP) — on failure,
   optionally on success.

Later: partial/table restore, instance self-registration, more users/roles, daily digest.

## Onboarding a new instance (manual, ~2 min)

1. Deploy root `docker-compose.yaml` in Coolify (set `CONVEX_VERSION` to pin, default `latest`).
2. `docker compose exec backend ./generate_admin_key.sh`.
3. Console → Instances → add URL + key → attach a job.

## Phases

1. **Build** v1 on `feat/backup-console`.
2. **Test** in a separate Coolify project — see `testing/TESTING.md`.
3. **Adopt**: merge; remove `backups` and `export-cleanup` services from the root template
   (`export-cleanup` is a no-op: with S3 storage, exports live in the RustFS bucket).

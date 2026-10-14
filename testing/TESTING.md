# Backup Console — Test Plan

Run in a **separate Coolify project**. Never against a real project's instance.

## Setup

- **Convex A** (source): root `docker-compose.yaml`, `CONVEX_VERSION=latest`. Seed tables + upload files.
- **Convex B** (restore target): same compose, same day (same `latest`), empty.
- **Console**: `backups/docker-compose.yaml`, Cloudflare Tunnel + Access on `backups.<domain>`.
- Destinations: Cloudflare R2 bucket + local volume. age encryption on.

## Pass criteria

| # | Check | Pass |
|---|---|---|
| 1 | Manual backup A → R2 + local | Both copies exist; archives are age-encrypted |
| 2 | Scheduled backup | Fires on cron; retention prunes beyond policy |
| 3 | Source cleanup | No export left in A's `convex-snapshot-exports` bucket |
| 4 | Restore A → B | Same tables, row counts, `_storage` files |
| 5 | DR drill: wipe A, restore A | Matches pre-wipe state |
| 6 | Zip download | Decrypted zip imports with `npx convex import` |
| 7 | Failure notification | Stop A, run job → alert arrives |
| 8 | Exposure | Server IP + spoofed `Host` header → no response; Access blocks unlisted email |
| 9 | Auth | Bad password throttled; TOTP required |

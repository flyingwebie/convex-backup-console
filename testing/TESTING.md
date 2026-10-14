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

## Local Docker run — 2026-10-14 (convex-backend `latest`, Postgres + RustFS template)

| # | Check | Result |
|---|---|---|
| 1 | Manual backup A → R2 stand-in + local | ✅ 1.34 MB zip on both (500 docs, 20 files). Encryption not built yet |
| 2 | Scheduled backup + keep-last-2 | ✅ cron `* * * * *` ran every minute; oldest copy pruned on both destinations |
| 3 | Source export cleanup | ✅ after `MAX_EXPIRED_SNAPSHOT_AGE_DAYS=0` was added to the template, only the newest export stays in A's bucket |
| 4 | Restore A → B (ReplaceAll) | ✅ 520 docs; fingerprint and all 20 file SHA-256 hashes match A |
| 5 | DR: `down -v` on A, restore from local copy | ✅ identical fingerprint and file hashes |
| 6 | Zip download | ✅ exact bytes, valid zip; 401 without a session |
| 7 | Failure handling | ✅ R2 down → `partial` (local copy kept); A down → `failed: Cannot reach … ECONNREFUSED`. Notifications not built yet |
| 8 | Exposure | ⏳ needs the real Cloudflare Tunnel |
| 9 | Auth | ✅ 2FA required before any action; 6th bad login in a minute → 429; wrong restore confirmation rejected |

Also checked: state and sessions survive a container redeploy; the container runs read-only as non-root;
old admin keys stay valid after a wipe as long as `INSTANCE_SECRET` is unchanged.

## Local Docker run #2 — encryption, retention, notifications, new UI (2026-10-14)

| Check | Result |
|---|---|
| Upgrade in place on an old database | ✅ new columns added by migration; existing job kept |
| age encryption | ✅ `.zip.age` on R2 + local; decrypted **offline with the official `age` CLI v1.2.1** → 500 notes, 20 attachments, 20 files, all CRCs OK |
| Encrypted restore into a wiped B (`requireEmpty`) | ✅ 520 docs; fingerprint and all 20 file SHA-256 match |
| `requireEmpty` into a non-empty instance | ✅ refused by Convex: "Table _storage already exists" |
| Retention tiers | ✅ unit tests (`retention.test.ts`, hand-computed GFS case); 1 daily → only the newest copy of the day kept on every destination |
| Notifications | ✅ generic webhook, Discord-format embed and SMTP email (Mailpit) delivered; success sent only to channels that opted in; restore success + failure events |
| Decrypted + raw `.age` download | ✅ |
| New shadcn UI, end to end | ✅ `testing/local/e2e/e2e.mjs`: 13 Playwright checks on a fresh console (login, 2FA enrolment, instances, destination, key, channel, job, run, download, refused restore, alert, overview, audit) |

Not testable locally: Telegram (needs api.telegram.org), real R2/Discord/Slack endpoints, Cloudflare Tunnel.

## Local Docker run #3 — workspaces (2026-10-14)

| Check | Result |
|---|---|
| Upgrade an existing single-tenant DB | ✅ "Default" workspace created; all instances/runs/jobs/key backfilled; admin promoted to platform admin; table rebuild kept FKs (0 violations) |
| Branding | ✅ SVG logo upload (served sandboxed), rename, slug, description, timezone |
| Isolation | ✅ new workspace sees no instances/runs of another; Operator of workspace B gets 404 for workspace A's backup |
| Invitations | ✅ link invite → new account → 2FA enrolment → lands in the invited workspace with the right role |
| Roles | ✅ Viewer: no add/run/download/invite UI, download API 401; owner changes role to Operator |
| Trash & deletion policy | ✅ job → Trash → restore; purge with "keep files" keeps backups restorable; purge with "delete files" removed the object from R2 (7 → 6) |
| Workspace deletion | ✅ deleted workspace disappears from the switcher; Platform shows it as Deleted and restores it |

`testing/local/e2e/e2e.mjs`: **22/22** checks passed on a fresh console.

## Local Docker run #4 — Convex Cloud (2026-10-14)

Cloud deployments speak the same HTTP API; the differences are the deploy key and URL lookup through
`api.convex.dev/api/deployment/url_for_key`. Tested locally with a mock of that endpoint
(`CONVEX_PROVISION_HOST`) and a Cloud-format key (`prod:<instance>|…`), which the backend accepts:

| Check | Result |
|---|---|
| Deploy key parsing | ✅ unit tests: prod/dev/preview-deployment accepted; project and preview-creation keys rejected with clear messages |
| Bad key | ✅ 401 from the lookup API → "Convex rejected this deploy key" (the real `api.convex.dev` returns 401 for invalid keys) |
| Connect | ✅ URL looked up from the key; instance shown as "Cloud · prod" |
| Backup | ✅ job on the Cloud instance ran successfully with the deploy key |
| Restore guard | ✅ extra warning when the target is a Cloud production deployment |

Not tested: a real Convex Cloud deployment (needs a deploy key from your account).
`e2e.mjs`: **26/26** checks passed.

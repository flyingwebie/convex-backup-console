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

## Local Docker run #5 — auth, strong additions, templates (2026-10-14)

`testing/local/e2e/e2e.mjs`: **38/38** on a fresh console. Highlights:

| Area | Checks |
|---|---|
| Sign-in | Google/GitHub/Microsoft buttons redirect to the IdP with our client id + callback; unverified (social-style) sessions are stepped up on `/verify`; passkey registered and used to sign in (Chromium virtual authenticator) |
| Object Lock | Refused on a bucket without it; locked copies survive retention; deleting a locked version is `AccessDenied` (RustFS) |
| Contents | Manifest (2 tables, 500 rows, 20 files) and comparison with the previous backup |
| Partial restore | Only the selected table is replaced. **Bug found and fixed:** the table index must be filtered too, or Convex wipes unselected tables on "replace" |
| Scrubbing | Titles become `[redacted]` in the target. **Bug found and fixed:** lossless JSON is required, because Convex writes floats as `123.0` and plain JSON round-trips them into Int64 |
| API & CI | Read token → 403 on run, bad token → 401; the real GitHub Action script triggered a backup and waited for `ok` |
| Monitoring | Status URL JSON (200/503), audit CSV, digest + invitation emails via SMTP (Mailpit), storage dashboard |

Coolify templates: both validate with `docker compose config`; the console template boots, seeds the admin and serves the login page.

Not testable locally: real Google/GitHub/Microsoft logins, real R2/B2 Object Lock, Telegram/Slack/Discord endpoints.

## Local Docker run #6 — branded emails, version in the sidebar (2026-10-14)

`testing/local/e2e/e2e.mjs`: **45/45** on a fresh console. Unit tests: **16/16** (renderer: every default template renders, values are escaped, dates use the workspace timezone, owner HTML is sanitised, unknown variables are rejected).

| Area | Checks |
|---|---|
| Migration | A legacy "Email" alert channel, inserted and followed by a restart, becomes external recipients of Backup failed/partial and Restore failed, then the channel is removed |
| Recipients | External address added to the digest; Operators toggled on for partial failures (saved per type) |
| Editor | Unknown variable shown as a warning and blocked on save; click-to-insert at the cursor; live preview (desktop 375 px mobile, plain text); test email arrives with an **inline PNG logo** (`cid:logo`, converted from the SVG) and a text part |
| Full HTML | "Start from current design", `<script>` and `onclick` stripped on save, History → Revert |
| Delivery | Digest to owners + the external address, with accent, footer and sender name; an Account opt-out stops it for that member only; invitation uses the template and links to `/invite/…` |
| Platform | Default template edited by a platform admin; the sidebar shows `v0.1.0` and links to GitHub |

**Bug found and fixed:** an instance stayed "busy" until alerts, emails and retention had finished, after the run already showed as done. A second Run was rejected for a few seconds. The lock is now released as soon as the run's status is final, and it is scoped to its run id, so an old run can't release a newer run's lock.

Test fix: the status-URL step clicked **Enable** before hydration on slow loads; it now retries until the toast confirms.

## Local Docker run #7 — first-run setup wizard (2026-10-14)

`testing/local/e2e/onboarding.mjs` (fresh container, no `ADMIN_EMAIL`): **8/8**. `e2e.mjs` (headless `ADMIN_EMAIL` path): **45/45**.

| Check | Result |
|---|---|
| Unclaimed console | Every page redirects to `/setup`; a one-time code `XXXX-XXXX-XXXX` is printed in the logs |
| Wrong code | Refused, no account created (10 tries/minute) |
| Right code | Accepted in any case/without dashes; platform admin created and signed in; the code is cleared, so `/setup` sends later visitors to sign in |
| 2FA | `/security` shows the wizard's progress and returns to the wizard; no "Default" workspace is auto-created |
| Workspace | Name, derived slug, SVG logo and timezone saved |
| Team | SMTP set up inline ("Save and send a test"); Admin and Viewer invitations emailed |
| Finish | Lands on the Overview; `/setup` then redirects home |

**Bug found and fixed (API tokens):** token prefixes were base64url, which can contain `_`, and the server split the token on `_`. About 1 in 8 tokens could never authenticate. The prefix is now read by position, which also works for existing tokens, and new prefixes are hex.

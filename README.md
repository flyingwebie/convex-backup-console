<div align="center">

<img src="coolify/svgs/convex-backup-console.svg" width="72" alt="Convex Backup Console logo" />

# Convex Backup Console

**Backups for Convex you can actually restore.**

Scheduled, encrypted, off-site backups for **self-hosted Convex** and **Convex Cloud**, with
point-and-click restores, ransomware-proof storage and a console your whole team can use.
Plus a production-ready **Convex-on-Coolify** template to run the instances themselves.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Deploy on Coolify](https://img.shields.io/badge/deploy%20on-Coolify-8C52FF?logo=coolify&logoColor=white)](coolify/README.md)
[![Convex](https://img.shields.io/badge/Convex-self--hosted%20%26%20Cloud-EE342F)](https://convex.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-TanStack%20Start-3178C6?logo=typescript&logoColor=white)](backups)
[![e2e](https://img.shields.io/badge/e2e-38%20checks-2ea44f)](testing/TESTING.md)

[Quick start](#-quick-start) · [Features](#-features) · [Screenshots](#-screenshots) · [How it works](#-how-it-works) · [Security](#-security) · [FAQ](#-faq)

<img src="docs/images/hero.png" alt="Convex Backup Console" width="100%" />

</div>

---

## Why

Convex's snapshot export is great, but a backup strategy needs more than `npx convex export` in a cron job:

- **Off-site, versioned and immutable copies.** A backup on the same server, or one an attacker can delete, isn't a backup.
- **Encryption you control**, so a leaked bucket doesn't leak your users' data.
- **Restores that are rehearsed and safe:** into a staging copy, one table at a time, with personal data scrubbed.
- **Visibility:** know when a backup *didn't* happen, not just when one failed.
- **One place for every project and client**, with proper access control.

Convex Backup Console does all of that in a single container.

## ✨ Features

<table>
<tr>
<td width="50%"><img src="docs/images/feature-restore.png" alt="Restore" /></td>
<td width="50%"><img src="docs/images/feature-storage.png" alt="Storage" /></td>
</tr>
<tr>
<td colspan="2"><img src="docs/images/feature-teams.png" alt="Teams" /></td>
</tr>
</table>

**Backups**
- 🔁 **Manual, cron or API-triggered** jobs, one instance → many destinations, including file storage.
- ☁️ **Self-hosted Convex** (URL + admin key) **and Convex Cloud** (deploy key; URL looked up automatically).
- 🔐 **age encryption** per workspace: decryptable offline with the standard `age` CLI.
- 🗄️ **S3-compatible destinations** (Cloudflare R2, AWS S3, Backblaze B2, Wasabi, MinIO, RustFS) and local volumes.
- 🧱 **S3 Object Lock:** backups can't be deleted or overwritten for N days, not even with stolen credentials.
- 🧹 **GFS retention** (keep-last + daily/weekly/monthly), **exports cleaned up** on the source automatically.
- 🧾 **Manifests:** tables, row counts, files and SHA-256 per backup, compared with the previous one.

**Restores**
- ↺ Into the **same or another instance**, in four modes (full, replace, append, empty-only).
- ✂️ **Partial restores:** only the tables you pick; everything else stays untouched.
- 🕶️ **Scrubbed staging copies:** fake emails, names and phones; redaction; hashing; consistent within a restore.
- ⬇️ **Download** any backup, decrypted or as the raw `.age` file.

**Operations**
- 📈 **Overview & storage dashboard:** health per instance, growth chart, monthly cost estimate.
- 🔔 **Alerts:** Slack, Discord, Telegram, email, webhook; daily/weekly **digest emails**.
- 🩺 **Status URL** for Uptime Kuma, Better Stack and UptimeRobot (200 healthy / 503 not).
- 🚀 **REST API + GitHub Action:** back up right before `npx convex deploy`.
- 🗑️ **Trash & deletion policy:** restore deleted items for N days; decide whether their backups go too.
- 📜 **Audit log** of every action, exportable as CSV.

**Teams**
- 🏢 **Workspaces**, e.g. one per client, each with its own logo, timezone, keys, alerts and members.
- 👥 **Roles:** Owner · Admin · Operator (run and download, no restore) · Viewer (read-only).
- 🔑 **Mandatory 2FA** (authenticator or passkey), **Google / GitHub / Microsoft** sign-in, invite-only accounts.
- 🛡️ Session management, sign out everywhere, admin 2FA reset, login rate limiting.

## 🚀 Quick start

### Coolify (recommended)

1. **+ New → Docker Compose Empty** → paste [`coolify/templates/convex-backup-console.yaml`](coolify/templates/convex-backup-console.yaml).
2. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Coolify generates the domain and the secrets.
3. **Deploy**, sign in, enrol 2FA, then create your encryption key in **Workspace → Settings**.

> **Save `SERVICE_PASSWORD_64_MASTERKEY` in your password manager.** It encrypts every stored key and secret.

Full guide, including OAuth setup: [`coolify/README.md`](coolify/README.md).

### Any Docker host

```bash
docker run -d --name convex-backups -p 3000:3000 \
  -v convex-backups:/data --read-only --tmpfs /tmp \
  -e PUBLIC_URL=https://backups.example.com \
  -e BACKUP_MASTER_KEY="$(openssl rand -base64 48)" \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 48)" \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='a-long-password' \
  ghcr.io/flyingwebie/convex-backup-console:latest
```

Put it behind HTTPS (Traefik, Caddy, Nginx or a Cloudflare Tunnel; see [`backups/docker-compose.tunnel.yaml`](backups/docker-compose.tunnel.yaml)).

### Then

| Step | Where |
|---|---|
| Add a **self-hosted** instance: API URL + `./generate_admin_key.sh` output | Instances → Add instance |
| Add a **Convex Cloud** deployment: a production or dev **deploy key** | Instances → Add instance → Convex Cloud ([guide](backups/README.md#back-up-a-convex-cloud-deployment)) |
| Add a destination (R2, S3, B2…), optionally with Object Lock | Destinations |
| Create a job: schedule, retention, encryption | Jobs |
| Get alerts | Notifications |

### Need a Convex instance first?

[`coolify/templates/convex.yaml`](coolify/templates/convex.yaml) deploys self-hosted Convex with **Postgres** and
**RustFS** (S3) storage on Coolify. The detailed walkthrough is in [`docs/convex-on-coolify.md`](docs/convex-on-coolify.md).

## 🖼️ Screenshots

| | |
|---|---|
| ![Overview](docs/images/screens/overview.png) **Overview:** health of every instance | ![Runs](docs/images/screens/runs.png) **Runs:** every backup and its copies |
| ![Contents](docs/images/screens/contents.png) **Contents:** tables, rows, changes since last backup | ![Restore](docs/images/screens/restore.png) **Restore:** pick target, mode, tables, scrubbing |
| ![Storage](docs/images/screens/storage.png) **Storage:** growth and monthly cost | ![Workspace](docs/images/screens/workspace.png) **Workspace settings:** branding, defaults, policies |
| ![Destinations](docs/images/screens/destinations.png) **Destinations** with Object Lock | ![Members](docs/images/screens/members.png) **Members & roles** |
| ![Login](docs/images/screens/login.png) **Sign-in:** password, Google, GitHub, Microsoft, passkeys | ![Dark mode](docs/images/screens/overview-dark.png) **Dark mode** |

## 🧠 How it works

```mermaid
flowchart LR
  subgraph Sources
    SH[Self-hosted Convex<br/>URL + admin key]
    CC[Convex Cloud<br/>deploy key]
  end
  subgraph Console[Convex Backup Console · one container]
    S[Scheduler / API / UI] --> X[Export → manifest → age encrypt]
    R[Restore: filter tables · scrub PII] --> I[Convex import API]
    DB[(SQLite · secrets encrypted<br/>with BACKUP_MASTER_KEY)]
  end
  SH & CC -- snapshot export --> X
  X --> D1[(Cloudflare R2)]
  X --> D2[(S3 / B2 with Object Lock)]
  X --> D3[(Local volume)]
  D1 & D2 & D3 --> R
  I --> SH & CC
  X -. alerts & digests .-> N[Slack · Discord · Telegram · Email · Webhook]
```

1. A job asks the instance for a **snapshot export** through Convex's admin HTTP API, the same API `npx convex export` uses.
2. The console downloads it, records a **manifest** (tables, row counts, files, SHA-256) and **encrypts** it with the workspace's age key.
3. The archive is uploaded to every destination (with **Object Lock** where configured), then **retention** prunes old copies and the export is removed from the source.
4. A **restore** downloads and decrypts a copy, optionally **filters tables** or **scrubs** personal data, and runs Convex's import with your chosen mode.

### Recover without the console

```bash
age -d -i convex-backups-age-key.txt backup.zip.age > backup.zip   # key from Workspace → Settings
npx convex import --replace-all backup.zip                           # into any Convex deployment
```

## 🔐 Security

| Area | How |
|---|---|
| Sign-in | Invite-only. Password (12+ characters) or Google / GitHub / Microsoft; **second factor always required** (TOTP or passkey), including after social sign-in |
| Sessions | 24h, HttpOnly cookies, per-session factor tracking, list/revoke, sign out everywhere |
| Brute force | 5 sign-in / 2FA attempts per minute per IP (Cloudflare-aware) |
| Secrets at rest | Admin keys, deploy keys, S3 secrets, webhook URLs and age keys are encrypted with AES-256-GCM under `BACKUP_MASTER_KEY` |
| Backups at rest | age (X25519) per workspace; S3 Object Lock for immutability |
| Isolation | Every query scoped to the active workspace; role checks on every server function and API call |
| Container | Non-root, read-only filesystem, all capabilities dropped |
| Audit | Every change, backup, restore, download and key reveal is logged |

## 🤖 Back up before every deploy

```yaml
- uses: flyingwebie/convex-selfhost-coolify/.github/actions/convex-backup@main
  with:
    console-url: https://backups.example.com
    token: ${{ secrets.BACKUP_CONSOLE_TOKEN }}   # Workspace → Settings → API tokens
    job-id: <job-id>
- run: npx convex deploy
```

The REST API is documented in [`docs/github-action.md`](docs/github-action.md).

## 🆚 Compared with

| | This console | `npx convex export` + cron | Convex Cloud built-in backups |
|---|:-:|:-:|:-:|
| Self-hosted **and** Cloud | ✅ | ✅ | Cloud only |
| Off-site copies in your own storage | ✅ | DIY | ❌ |
| Encryption you hold the key to | ✅ | DIY | ❌ |
| Immutable (Object Lock) | ✅ | DIY | ❌ |
| Partial & scrubbed restores | ✅ | ❌ | ❌ |
| Alerts, digests, status URL | ✅ | DIY | — |
| Multi-project, roles, audit log | ✅ | ❌ | Per-team |

Convex Cloud's own backups are excellent, so keep them on. This adds independent, encrypted copies outside Convex.

## 📁 Repository

```
backups/                 Convex Backup Console (TanStack Start · Better Auth · SQLite · shadcn/ui)
coolify/                 Coolify templates (console + Convex instance) and logo
docker-compose.yaml      Convex-on-Coolify instance template (Postgres + RustFS)
docs/                    Guides, API reference, images
testing/                 Local Docker kit, Playwright e2e (38 checks), demo data
.github/                 Image build (amd64 + arm64) and the convex-backup GitHub Action
```

## 🧪 Development & tests

```bash
cd backups && pnpm install
BACKUP_MASTER_KEY=dev BETTER_AUTH_SECRET=dev-secret-at-least-32-characters-long \
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password' pnpm dev
pnpm exec vitest run
```

The end-to-end suite runs two real Convex stacks (Postgres + RustFS), an S3 stand-in, Mailpit and a
webhook receiver locally. See [`testing/local/README.md`](testing/local/README.md) and the results in [`testing/TESTING.md`](testing/TESTING.md).

## ❓ FAQ

**Does it need Cloudflare?**
No. Cloudflare R2 is a great destination and Cloudflare Tunnel is an optional hardening layer, but neither is required.

**What happens if I lose the console?**
Your backups are plain (or age-encrypted) Convex snapshot zips in your own buckets. Decrypt them with the age key you saved and `npx convex import` them. The console is a convenience, not a dependency.

**Can I restore into Convex Cloud?**
Yes, with a deploy key for the target deployment. Restores into a *production* Cloud deployment show an extra warning.

**How big can a backup be?**
Exports are streamed to disk and uploaded in parts, so size is bounded by the container's free disk space, not memory.

**Is Microsoft sign-in work-accounts only?**
Set `MICROSOFT_TENANT_ID` to `common` (any account), `organizations` (work/school), or your tenant ID.

## 🗺️ Roadmap

- Scheduled restore drills with automatic verification
- Backing up Convex environment variables alongside data
- Self-registration of new instances from the Convex template
- One-click template in Coolify's built-in catalogue ([how to submit](coolify/README.md#submit-them-to-coolifys-built-in-template-list))

## License

[MIT](LICENSE) © Davide Del Gatto · Flying Web Solutions. Not affiliated with Convex, Inc. or Coolify.

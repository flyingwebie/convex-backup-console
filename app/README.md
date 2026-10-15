# Convex Backup Console

One shared console that backs up and restores **many** Convex deployments — **self-hosted** instances
(deployed from [`convex-instance.coolify.yaml`](../convex-instance.coolify.yaml)) and **Convex Cloud** deployments — organised in **workspaces**. Design notes: [PLAN.md](PLAN.md).

- **Workspaces:** e.g. one per client. Each has its own instances, destinations, jobs, alerts,
  encryption key, members, logo, name, colour theme, timezone, job defaults, backup-health threshold and deletion
  policy. Switch between them in the sidebar.
- **Members & roles:** invite by link (and email when SMTP is set). Roles: Owner, Admin, Operator
  (run and download, no restore), Viewer (read-only). Platform admins create workspaces and manage users.
- **Deletion policy & Trash:** deleted workspaces, instances, jobs and destinations stay restorable for
  N days (default 7), then are purged. Two separate toggles decide whether their backup files are also
  deleted from **remote storage** (S3-compatible) and from **local storage** (volumes), each after its own
  delay (days after the purge; 0 = at the purge). Both are off by default. Files under Object Lock are
  deleted once the lock expires; turning a toggle off cancels its pending deletions.
- **API switch:** API access and the GitHub Action can be turned off per workspace.

- **Sources:** self-hosted Convex (URL + admin key) and **Convex Cloud** (deploy key; URL looked up automatically).
- **Backups:** manual or cron, to S3-compatible storage (Cloudflare R2, AWS S3, Backblaze B2, MinIO)
  and/or a local volume, with file storage included. Exports are removed from the source instance
  once a copy is stored.
- **Encryption:** optional per job, with [age](https://age-encryption.org) (X25519). Backups stay
  recoverable without the console: `age -d -i key.txt backup.zip.age > backup.zip`.
- **Retention:** per destination: latest N plus daily / weekly / monthly tiers (e.g. 7 / 4 / 12).
- **Restore:** to the same or another instance (full, replace tables, append, or empty-only), with a
  typed-name confirmation. Zip download, decrypted or raw `.age`.
- **Emails (Emails page):** branded React Email layout with the workspace logo (inlined as PNG), accent colour, footer and
  sender name. Templates use Liquid variables (`{{ instance.name }}`, `{{ run.bytes | bytes }}`, `{{ run.started_at | date: "%-d %b" }}`)
  with a live preview, test sends, history (last 20) and reset to the platform default. Owners can switch a template to full
  HTML (sanitised on save, with a fallback to the default if it fails to render) and set the workspace's own SMTP server.
  A recipients grid decides who gets each email: roles, specific members, outside addresses and "who did it". Members can opt out
  under Account; security emails (password changed, passkey added, 2FA reset) are always sent.
- **Chat alerts:** Discord, Slack, Telegram or a generic webhook, on failure and optionally on success.
- **Security:** email + password with mandatory TOTP 2FA, backup codes, login rate limiting,
  secrets encrypted at rest, audit log of every action.

## Deploy in Coolify (once)

1. **New resource → Docker Compose** from this Git repo, **Docker Compose Location** `/app/docker-compose.yaml` (or paste [`backup-console.coolify.yaml`](../backup-console.coolify.yaml)).
2. Deploy. Coolify generates the domain and the secrets. Open the URL: the **setup wizard** asks for the one-time
   setup code printed in the service's **Logs**, then creates your admin account, two-factor, the first workspace
   (name, logo, timezone) and invites your team. (Headless alternative: set `ADMIN_EMAIL` / `ADMIN_PASSWORD`.)
3. **Copy `SERVICE_PASSWORD_64_MASTERKEY` into your password manager.** It encrypts the stored admin
   keys, S3 secrets and the age key; without it they can't be decrypted.
4. Deploy, open the domain, sign in and enrol 2FA (mandatory). You're a platform admin and owner of a
   "Default" workspace: rename it, add a logo and timezone in **Workspace → Settings**, create its
   encryption key and save the private key in your password manager.
5. Optional: **Platform → Email (SMTP)** so invitations, alerts and digests are emailed (a workspace owner can also set its own on the Emails page). Create more workspaces from the
   workspace switcher.

The image is published by `.github/workflows/backup-console.yml` to `ghcr.io/flyingwebie/convex-backup-console`.
Pin a version with `CONSOLE_VERSION=sha-xxxxxxx`. If the package is private, add GHCR credentials to Coolify.

### Optional: Cloudflare Tunnel + Access

The console is safe on a normal domain (2FA + rate limiting). If you also want it **unreachable from the
internet except through Cloudflare's login**, deploy `/app/docker-compose.tunnel.yaml` instead:

1. Zero Trust → Networks → Tunnels → create a tunnel; put its token in `TUNNEL_TOKEN`.
2. Add a public hostname `backups.example.com` → `http://app:3000`; set `PUBLIC_URL` to that URL.
3. Zero Trust → Access → Applications → Self-hosted for that hostname; policy *Allow* your team's emails, One-time PIN.

## Register a new Convex instance (~2 min)

1. Deploy [`convex-instance.coolify.yaml`](../convex-instance.coolify.yaml) for the project (`CONVEX_VERSION` defaults to `latest`).
2. In Coolify, open the instance's `backend` terminal and run `./generate_admin_key.sh`.
3. Console → pick the client's workspace → **Instances → Add instance**: the instance's public API URL (`SERVICE_URL_BACKEND`) and the admin key.
4. **Jobs → New job**: pick destinations, a schedule and retention.

## Back up a Convex Cloud deployment

Convex Cloud deployments are backed up with the same export/import API as self-hosted ones. Instead of
an admin key, the console uses a **deploy key** for one specific deployment.

### 1. Create a deploy key (Convex dashboard)

1. Open [dashboard.convex.dev](https://dashboard.convex.dev) → your team → the **project**.
2. Pick the deployment to protect with the selector at the top: **Production** (usual), or a **Development** deployment.
3. Open the deployment's **Settings** and find the deploy key section (**URL & Deploy Key**).
4. Click **Generate Production Deploy Key** (or *Development*). Name it e.g. `backup-console`.
5. Copy the key; it is only shown once. It looks like:
   - `prod:happy-otter-123|eyJ2…`  ← production deployment
   - `dev:quiet-fox-456|eyJ2…`    ← development deployment
   - `preview:brave-cat-789|eyJ2…` ← one specific preview deployment

Keys the console **refuses** (they aren't tied to one deployment): **project keys** (`project:team:project|…`)
and **preview deploy keys** that create previews (`preview:team:project|…`). Team access tokens don't work either.

> A deploy key grants full admin access to that deployment: anyone holding it can read and overwrite data.
> The console stores it encrypted with `BACKUP_MASTER_KEY`. Give the console its own key so you can revoke it independently.

### 2. Add it to the console

1. Switch to the right workspace → **Instances → Add instance → Convex Cloud**.
2. Enter a name (used in backup paths, e.g. `acme-prod-cloud`) and paste the deploy key.
3. Leave **Deployment URL** empty: the console asks Convex (`api.convex.dev`) for the URL behind the key,
   which also covers EU-region deployments. Fill it in only if you serve the deployment from a **custom domain**.
4. **Connect**. The console checks the key against the deployment before saving. The instance shows as
   **Cloud · prod** (or `dev`/`preview`).
5. Create a job for it as usual (**Jobs → New job**).

The console needs outbound HTTPS to `api.convex.dev` and `*.convex.cloud`.

### Rotating or revoking the key

Generate a new deploy key in the dashboard → console **Instances → ⋯ → Edit** → paste it into *Deploy key*
→ **Save** (it's verified first) → then revoke the old key in the Convex dashboard.

### Notes for Cloud

- **Restores into production** show an extra warning. Prefer restoring into a Development deployment first;
  use a `dev:` key for it as a separate instance.
- Convex Cloud also keeps its own backups (dashboard → **Backups**, availability depends on your plan).
  This console complements them with **encrypted copies in your own storage**, outside Convex.
- Each export is removed from Convex once a copy is stored, so it doesn't pile up in the dashboard's Backups list.
- Exports and downloads may count towards your Convex plan's bandwidth.
- `CONVEX_PROVISION_HOST` overrides `https://api.convex.dev`. It's used only for local testing against a mock.

## Development

```bash
cd app && pnpm install
BACKUP_MASTER_KEY=dev BETTER_AUTH_SECRET=dev-secret-at-least-32-characters-long \
SETUP_CODE=dev-setup pnpm dev   # then open http://localhost:3000/setup
pnpm exec vitest run        # unit tests (retention)
```

End-to-end: see `testing/local/README.md` and `testing/local/e2e/e2e.mjs`. UI components are
[shadcn/ui](https://ui.shadcn.com) (`bunx --bun shadcn@latest add <component>`).

# Convex Backup Console

One shared console that backs up and restores **many** self-hosted Convex instances (each deployed
from this repo's root `docker-compose.yaml`). Design notes: [PLAN.md](PLAN.md).

- **Backups:** manual or cron, to S3-compatible storage (Cloudflare R2, AWS S3, Backblaze B2, MinIO)
  and/or a local volume, with file storage included. Exports are removed from the source instance
  once a copy is stored.
- **Encryption:** optional per job, with [age](https://age-encryption.org) (X25519). Backups stay
  recoverable without the console: `age -d -i key.txt backup.zip.age > backup.zip`.
- **Retention:** per destination: latest N plus daily / weekly / monthly tiers (e.g. 7 / 4 / 12).
- **Restore:** to the same or another instance (full, replace tables, append, or empty-only), with a
  typed-name confirmation. Zip download, decrypted or raw `.age`.
- **Alerts:** Discord, Slack, Telegram, email (SMTP) or a generic webhook, on failure and optionally on success.
- **Security:** email + password with mandatory TOTP 2FA, backup codes, login rate limiting,
  secrets encrypted at rest, audit log of every action.

## Deploy in Coolify (once)

1. **New resource → Docker Compose** from this Git repo, **Docker Compose Location** `/backups/docker-compose.yaml`.
2. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ characters). Coolify generates the domain and the secrets.
3. **Copy `SERVICE_PASSWORD_64_MASTERKEY` into your password manager.** It encrypts the stored admin
   keys, S3 secrets and the age key; without it they can't be decrypted.
4. Deploy, open the domain, sign in, enrol 2FA (mandatory), then in **Settings** create the encryption
   key and save the private key in your password manager.

The image is published by `.github/workflows/backup-console.yml` to `ghcr.io/flyingwebie/convex-backup-console`.
Pin a version with `CONSOLE_VERSION=sha-xxxxxxx`. If the package is private, add GHCR credentials to Coolify.

### Optional: Cloudflare Tunnel + Access

The console is safe on a normal domain (2FA + rate limiting). If you also want it **unreachable from the
internet except through Cloudflare's login**, deploy `/backups/docker-compose.tunnel.yaml` instead:

1. Zero Trust → Networks → Tunnels → create a tunnel; put its token in `TUNNEL_TOKEN`.
2. Add a public hostname `backups.example.com` → `http://app:3000`; set `PUBLIC_URL` to that URL.
3. Zero Trust → Access → Applications → Self-hosted for that hostname; policy *Allow* your team's emails, One-time PIN.

## Register a new Convex instance (~2 min)

1. Deploy the root `docker-compose.yaml` for the project (`CONVEX_VERSION` defaults to `latest`).
2. In Coolify, open the instance's `backend` terminal and run `./generate_admin_key.sh`.
3. Console → **Instances → Add instance**: the instance's public API URL (`SERVICE_URL_BACKEND`) and the admin key.
4. **Jobs → New job**: pick destinations, a schedule and retention.

## Development

```bash
cd backups && pnpm install
BACKUP_MASTER_KEY=dev BETTER_AUTH_SECRET=dev-secret-at-least-32-characters-long \
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password' pnpm dev
pnpm exec vitest run        # unit tests (retention)
```

End-to-end: see `testing/local/README.md` and `testing/local/e2e/e2e.mjs`. UI components are
[shadcn/ui](https://ui.shadcn.com) (`bunx --bun shadcn@latest add <component>`).

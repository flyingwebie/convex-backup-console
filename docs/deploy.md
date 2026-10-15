# Deploying the console

The console is one container: a Node server with an embedded SQLite database and the backup scheduler.
Wherever you run it, it needs:

| Requirement | Why |
|---|---|
| **An always-on process** | Scheduled backups, retention, digests and "no recent backup" alerts run inside the app. |
| **A persistent volume at `/data`** | The database (instances, keys, users, audit log), logos and temporary export files. |
| **Exactly one instance** | SQLite and the scheduler aren't meant to run twice. Don't scale horizontally. |
| **~512 MB RAM, disk ≥ your largest backup** | Exports are streamed to disk before upload, never held in memory. |
| `BACKUP_MASTER_KEY`, `BETTER_AUTH_SECRET` | Random secrets (`openssl rand -base64 48`). **Store the master key in a password manager**: it decrypts the stored admin keys and credentials. |

After the first deploy, open the URL. The **setup wizard** asks for a one-time code that the console prints in its
logs, then creates your admin account, two-factor, the first workspace and invites your team. `PUBLIC_URL` is
detected on Render, Railway and Fly.io; set it yourself when you use a custom domain.

## Where it runs

| Platform | Works? | Notes |
|---|---|---|
| [Coolify](coolify.md) | ✅ Recommended | Template with hardening (read-only root, no capabilities). Also hosts your Convex instances. |
| [Render](#render) | ✅ One click | Needs a paid instance type for the disk (Starter or above). |
| [Railway](#railway) | ✅ | Add a volume at `/data`. |
| [Fly.io](#flyio) | ✅ | Volume + `auto_stop_machines = "off"`. |
| [Any Docker host](#docker) | ✅ | VPS, Hetzner, DigitalOcean Droplet, Dokploy, CapRover, a NAS… |
| Vercel, Netlify, Cloudflare Pages/Workers | ❌ | Serverless: no long-running process for schedules and no persistent disk for the database. |
| Heroku, DigitalOcean App Platform | ❌ | No persistent volumes for web services; the database would be wiped on every deploy. |

> Using Vercel for your *app*? That's fine. Your Convex deployment (Cloud or self-hosted) can be anywhere; only
> the backup console needs a host from the ✅ list.

## Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/flyingwebie/convex-backup-console)

1. Click the button. Render reads [`render.yaml`](../render.yaml): a Docker web service built from `app/`, a 5 GB disk at
   `/data`, a health check, and generated `BACKUP_MASTER_KEY` / `BETTER_AUTH_SECRET`.
2. Pick a region and **Apply**. The first build takes a few minutes.
3. Copy `BACKUP_MASTER_KEY` from the service's **Environment** tab into your password manager.
4. Open **Logs**, find the setup code, then open `https://<service>.onrender.com`.

Custom domain: add it under **Settings → Custom Domains**, then set `PUBLIC_URL=https://backups.example.com`.

## Railway

1. **New Project → Deploy from GitHub repo** → `flyingwebie/convex-backup-console` (or your fork).
2. In the service's **Settings**: set **Root Directory** to `/app`. Railway then uses [`app/railway.json`](../app/railway.json):
   Dockerfile build, health check, one replica.
3. **Variables**: add `BACKUP_MASTER_KEY` and `BETTER_AUTH_SECRET` (generate each with `openssl rand -base64 48`).
4. Right-click the service → **Attach Volume**, mount path **`/data`**.
5. **Settings → Networking → Generate Domain** (target port 3000). `PUBLIC_URL` is taken from it.
6. **Deploy**, read the setup code in **Deploy Logs**, open the domain.

> **Maintainers:** turn this into a one-click button by publishing a Railway template (Project → **Create
> Template** with the volume and variables, using `${{secret(48)}}` for the two secrets). Then link
> `https://railway.com/template/<code>` with `https://railway.com/button.svg` in the README.

## Fly.io

```bash
cd app
fly launch --copy-config --no-deploy        # pick a unique app name; it rewrites `app` in fly.toml
fly secrets set BACKUP_MASTER_KEY="$(openssl rand -base64 48)" BETTER_AUTH_SECRET="$(openssl rand -base64 48)"
fly deploy --ha=false                       # one machine; the 5 GB volume is created from fly.toml
fly logs                                    # setup code → open https://<app>.fly.dev
```

[`app/fly.toml`](../app/fly.toml) keeps the machine running (`auto_stop_machines = "off"`), because a stopped
machine can't run scheduled backups. Save `BACKUP_MASTER_KEY` before you lose the terminal: Fly secrets can't be read back.

## Docker

```bash
docker run -d --name convex-backups --restart unless-stopped -p 3000:3000 \
  -v convex-backups:/data --read-only --tmpfs /tmp \
  -e PUBLIC_URL=https://backups.example.com \
  -e BACKUP_MASTER_KEY="$(openssl rand -base64 48)" \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 48)" \
  ghcr.io/flyingwebie/convex-backup-console:latest
docker logs convex-backups                  # setup code
```

Or build it yourself: `docker build -t convex-backup-console app`. Put it behind HTTPS (Caddy, Traefik, Nginx or a
Cloudflare Tunnel; see [`app/docker-compose.tunnel.yaml`](../app/docker-compose.tunnel.yaml)).

## Upgrading and backing up the console itself

- Redeploy with a newer image or commit; database migrations run automatically on start.
- Back up the `/data` volume (it holds the encrypted configuration) and keep `BACKUP_MASTER_KEY` plus each
  workspace's age key outside the server. Your backups themselves stay readable without the console.

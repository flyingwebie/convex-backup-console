# Back up before every deploy (GitHub Actions)

1. Console → **Workspace settings → API tokens → New token**, scope **Run backups**. Copy the token (`cbc_…`).
2. In GitHub → repo → **Settings → Secrets and variables → Actions**, add `BACKUP_CONSOLE_TOKEN`.
3. Copy the job ID from the API tokens card (or `GET /api/v1/jobs`).
4. Add the step before your deploy:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Back up production first
        uses: flyingwebie/convex-backup-console/.github/actions/convex-backup@main
        with:
          console-url: https://backups.example.com
          token: ${{ secrets.BACKUP_CONSOLE_TOKEN }}
          job-id: 0192f0c4-…        # your job
          timeout-minutes: 30

      - run: npm ci
      - run: npx convex deploy
        env:
          CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_DEPLOY_KEY }}
```

The deploy only runs if the backup finished with status `ok`. Pass `allow-partial: "true"` to also
accept backups where some, but not all, destinations failed.

### Turning it off

**Workspace settings → API tokens → Allow API access & GitHub Action** switches the whole API off for the
workspace (tokens are kept). While it's off, the API answers `403 API access is disabled for this workspace` and
the Action **skips the backup with a warning** (output `status=skipped`) so your deploy still runs.
Set `fail-when-disabled: "true"` if you'd rather block deploys while it's off.

## REST API

All endpoints take `Authorization: Bearer cbc_…` and act on the token's workspace.

| Method | Path | Scope | Returns |
|---|---|---|---|
| `GET` | `/api/v1/jobs` | read | `{ jobs: [{ id, name, instance, cron, enabled }] }` |
| `POST` | `/api/v1/jobs/:id/run` | run | `202 { runId, status: "running" }` (409 if one is already running) |
| `GET` | `/api/v1/runs/:id` | read | `{ id, status, bytes, sha256, error, copies, started_at, finished_at }` |
| `GET` | `/api/v1/status` | read | Workspace health; `200` healthy, `503` not |

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" https://backups.example.com/api/v1/jobs/$JOB/run
```

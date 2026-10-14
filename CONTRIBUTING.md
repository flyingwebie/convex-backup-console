# Contributing

Thanks for helping make Convex backups safer! Bug reports, docs fixes, templates and features are all welcome.

## Before you start

- **Bugs:** open an issue with what you did, what you expected and what happened. Include the console version
  (bottom of the sidebar, e.g. `v0.1.0 · 1a2b3c4`), your Convex version and whether it's self-hosted or Cloud.
  Please redact URLs, keys and emails.
- **Features:** open an issue first so we can agree on the approach before you spend time on it.
- **Security issues:** never in public issues — see [SECURITY.md](SECURITY.md).

## Repository layout

| Path | What |
|---|---|
| `app/` | The console: TanStack Start (React 19, Vite), Better Auth, SQLite (better-sqlite3), React Email, shadcn/ui |
| `backup-console.coolify.yaml` | Coolify template for the console |
| `convex-instance.coolify.yaml` | Coolify template for a self-hosted Convex instance |
| `.github/actions/convex-backup` | GitHub Action that triggers a backup before `npx convex deploy` |
| `docs/` | Guides and images |
| `testing/` | Local Docker kit and Playwright end-to-end tests |
| `legacy/` | The old all-in-one instance compose (kept for existing deployments, not developed) |

## Development

Requirements: Node 22+, pnpm 10 (`corepack enable`), Docker for the end-to-end tests.

```bash
cd app
pnpm install
BACKUP_MASTER_KEY=dev BETTER_AUTH_SECRET=dev-secret-at-least-32-characters-long \
SETUP_CODE=dev-setup pnpm dev        # open http://localhost:3000/setup, code: dev-setup
```

Before opening a pull request:

```bash
pnpm typecheck
pnpm test        # unit tests (retention, deploy keys, zip rewriting, email rendering)
pnpm build
```

Changes that touch backups, restores, auth, permissions or email delivery should also pass the end-to-end suites
(`testing/local/e2e/e2e.mjs` and `onboarding.mjs`). They run against real Convex backends, an S3 stand-in and Mailpit
in Docker; [`testing/local/README.md`](testing/local/README.md) explains the setup. Add or adjust a check when you change
behaviour, and mention in the PR which suites you ran.

## Conventions

- **Code:** match the surrounding style: TypeScript strict, server code in `*.server.ts`, server functions in
  `app/src/server/*fns.ts` with a zod validator and a permission check (`requireWorkspace(action)`), and every
  state-changing action written to the audit log.
- **Database:** schema changes go in `migrate()` in `app/src/server/db.server.ts` and must be idempotent and safe for
  existing installs (add columns; rebuild tables with create → copy → drop → rename).
- **Secrets:** anything sensitive is stored encrypted (`encrypt()` from `crypto.server.ts`) and never returned to the
  browser in full.
- **UI:** shadcn/ui components, plain English, sentence case. Destructive actions need a confirmation.
- **Commits:** [Gitmoji](https://gitmoji.dev) + [Conventional Commits](https://www.conventionalcommits.org), e.g.
  `✨ feat(emails): add reply-to per workspace` or `🐛 fix(restore): keep unselected tables`.
- Keep pull requests focused; one change per PR is easier to review.

## Releases

Images are built for amd64 and arm64 by `.github/workflows/backup-console.yml` and published to
`ghcr.io/flyingwebie/convex-backup-console` (`latest`, `sha-…` and `console-vX.Y.Z` tags). Bump `version` in
`app/package.json` with each release.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

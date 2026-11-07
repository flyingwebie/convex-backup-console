# Contributing

Thanks for helping make Convex backups safer! Bug reports, docs fixes, templates and features are all welcome.

## Before you start

- **Bugs:** open an issue with what you did, what you expected and what happened. Include the console version
  (bottom of the sidebar, e.g. `v1.0.0-beta.1 · 1a2b3c4`), your Convex version and whether it's self-hosted or Cloud.
  Please redact URLs, keys and emails.
- **Features:** open an issue first so we can agree on the approach before you spend time on it.
- **Security issues:** never in public issues — see [SECURITY.md](SECURITY.md).

## Repository layout

| Path | What |
|---|---|
| `app/` | The console: TanStack Start (React 19, Vite), Better Auth, SQLite (better-sqlite3), React Email, shadcn/ui |
| `backup-console.coolify.yaml` | Coolify template for the console |
| `convex-instance.coolify.yaml` | Coolify template for a self-hosted Convex instance |
| `render.yaml`, `app/railway.json`, `app/fly.toml` | One-click / config-as-code deploys ([docs/deploy.md](docs/deploy.md)) |
| `.github/actions/convex-backup` | GitHub Action that triggers a backup before `npx convex deploy` |
| `.github/workflows/ci.yml` | Pull request / push CI: typecheck, test, build, Docker build, dependency licence check |
| `.github/workflows/cla.yml` | CLA Assistant Lite bot |
| `lefthook.yml` | Git hook definitions (pre-commit, commit-msg, pre-push) |
| `CLA.md` | Contributor License Agreement |
| `docs/` | Guides and images (CC BY 4.0, see [`docs/LICENSE`](docs/LICENSE)) |
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
`ghcr.io/flyingwebie/convex-backup-console` (`latest`, `sha-…` and `X.Y.Z` tags). Every user-facing change bumps
`version` in `app/package.json` and adds a section to [`CHANGELOG.md`](CHANGELOG.md). When a new version is merged
to `main`, CI publishes the `X.Y.Z` image tag, tags the commit `console-vX.Y.Z` and creates the GitHub release
(notes from the changelog; versions with a `-` suffix are marked pre-release).

## CI

Pull requests to `main` and pushes to `main` run three checks (job names `checks`, `docker` and `licenses`
in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- **checks** — `pnpm typecheck`, `pnpm test` and `pnpm build` in `app/`.
- **docker** — builds the `app/Dockerfile` image (no push) to catch build breakage.
- **licenses** — runs [`app/scripts/check-licenses.mjs`](app/scripts/check-licenses.mjs) over production
  dependencies and fails on licences incompatible with AGPL-3.0-or-later (SSPL, BUSL/BSL, Commons Clause,
  Elastic License, non-commercial licences, GPL-2.0-only, proprietary/unlicensed packages). Unknown licences are
  reported as warnings. If a flagged dependency is actually fine, add it to
  [`app/scripts/license-allowlist.json`](app/scripts/license-allowlist.json) with a short reason.

All three are required status checks before merging.

## Git hooks

Hooks are managed by [lefthook](https://lefthook.dev) and installed automatically by `pnpm install` in `app/`
(the `prepare` script runs `lefthook install`; it's a no-op outside a git work tree, e.g. in the Docker build).

- **pre-commit** — typecheck on staged `app/**/*.{ts,tsx}` changes.
- **commit-msg** — validates the Gitmoji + Conventional Commits format described under Conventions above.
- **pre-push** — `pnpm test` and `pnpm build`.

Skip hooks in an emergency with `LEFTHOOK=0 git commit …` / `LEFTHOOK=0 git push …`. Please don't make this a habit.

## Contributor License Agreement (CLA)

Before a pull request from outside the project owner can be merged, the CLA bot asks you to sign the
[Contributor License Agreement](CLA.md) by commenting the sign phrase it posts on your PR. This grants the
project owner the rights needed to maintain, relicense and (if ever needed) dual-license the project — it is
**not** a copyright assignment; you keep your copyright. The CLA is pending a legal review before a 1.0 release.

AI coding assistants credited in a `Co-Authored-By` trailer (e.g. Claude) and bots are exempt: the person who
opens the pull request signs for the work they submit, including AI-assisted changes.

## Licence of contributions

By contributing you agree that your contributions to code are licensed under the project's
[AGPL-3.0-or-later License](LICENSE), and your contributions to `docs/` and this README under
[CC BY 4.0](docs/LICENSE) — both subject to the [CLA](CLA.md).

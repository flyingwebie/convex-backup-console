# Changelog

All notable changes to the Convex Backup Console. Versions follow [SemVer](https://semver.org); images are
published as `ghcr.io/flyingwebie/convex-backup-console:<version>`.

## 1.0.0-beta.3 — 2026-11-07

### Added

- **Create bucket for me:** Destinations → a wizard that provisions a Cloudflare R2 or AWS S3 bucket
  from a one-time setup credential, then mints a brand-new credential scoped to only that bucket (an
  R2 account token or a least-privilege IAM user) and saves it as a destination. Shows a step-by-step
  progress log with timings and rolls back anything it created if a later step fails. The setup
  credential is never persisted, logged, or shown again. When it's done, one click creates the first job
  for the new destination.
- **Topology map** on the Overview: instances → jobs → destinations, with each connection colored by its
  last run (running connections animate) and hover to highlight one path.
- **Command palette (⌘K / Ctrl+K):** jump to any page, instance, job or destination, and run quick actions
  (new job, add destination, create a bucket, toggle theme).
- **Run pipeline:** every backup shows its export → compress → encrypt → upload steps, expandable in the
  table and in the run details.
- **Restore lineage:** each restore shows the source backup connected to its target instance above the
  live log.
- **Retention timeline** on Storage (latest / daily / weekly / monthly copies per destination) and a
  clickable chart legend to isolate one destination.
- Workspace settings get a sticky section menu; workspaces show their accent color in the switcher.

### Changed

- **New design** across every screen: a calmer graphite palette in light and dark, Geist Mono for ids,
  sizes, cron and logs, status colors used consistently everywhere, and linked chips that take you to the
  related instance, job, destination or run.
- Sign-in, verification, first-run setup and invites use a two-pane layout; the setup panel builds the
  backup topology as you go.
- Destinations show the provider, lock status and which jobs write to them; Instances show which jobs
  back them up; Jobs show the instance → destination connection with the schedule and last result.
- Notifications show Discord / Slack / Telegram logos; the product tour has a new look with step dots.

### Fixed

- A stray `0` could render in a restore card's footer.

## 1.0.0-beta.2 — 2026-10-18

### Added

- **Live restore log:** every restore streams a terminal-style log in Runs → Restores — download and
  decryption progress, snapshot preparation, each upload part, Convex's progress messages and change summary,
  and the final document count. It updates every second while the restore runs, follows the output unless you
  scroll up, and can be copied. Older restores show their change summary instead.
- **Restores show source → target:** the source instance, backup date, size, encryption and the storage it came
  from, next to the target instance, its URL and the restore mode, plus who started it and how long it took.
- **Backups table:** search, status/instance filters, a date range (kept in the URL) and sortable columns.
- **Delete a backup** permanently with two confirmations (type `DELETE`); owners only.

### Changed

- Dropdown menus size to their content, so labels no longer wrap.
- Restores that were running when the console restarted are marked failed instead of staying "Running".
- Releases are automatic: a new `version` in `app/package.json` merged to `main` publishes the
  `<version>` image tag, tags the commit `console-v<version>` and creates the GitHub release.

## 1.0.0-beta.1 — 2026-10-15

First public beta.

### Added

- **Deletion policy delays:** when deleting backup files from remote or local storage is turned on, choose how
  many days after an item is purged from the Trash its files are deleted (0 = at the purge). Turning a toggle
  off cancels pending deletions; files under Object Lock are now deleted once their lock expires instead of
  being skipped for good. A deleted workspace is purged once its last files are due.
- **Product tour** (driver.js): starts on a user's first visit and walks through the setup order (instances →
  destinations → jobs → restores), then health, alerts, settings and the encryption key, members, Trash and the
  account menu. Steps follow the user's role; replay it from the account menu → **Take the tour**.
- **Workspace colour themes:** Neutral, Blue, Green, Teal, Violet, Orange or Rose, chosen in Workspace
  settings → Appearance and applied for every member (light/dark mode stays per user).

### Included from the pre-release work

Scheduled and manual backups of self-hosted Convex and Convex Cloud to S3-compatible and local storage, GFS
retention, age encryption, Object Lock, restores (4 modes, partial and scrubbed), workspaces with roles,
Trash, branded emails and digests, notifications, API tokens + GitHub Action, Google/GitHub/Microsoft
sign-in, passkeys and mandatory 2FA, setup wizard, and one-click deploys for Coolify, Render, Railway and Fly.io.

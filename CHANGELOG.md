# Changelog

All notable changes to the Convex Backup Console. Versions follow [SemVer](https://semver.org); images are
published as `ghcr.io/flyingwebie/convex-backup-console:<version>`.

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

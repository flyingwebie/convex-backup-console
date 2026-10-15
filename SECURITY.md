# Security policy

The console holds admin keys for Convex deployments and credentials for backup storage, so we take reports seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's
[private vulnerability reporting](https://github.com/flyingwebie/convex-backup-console/security/advisories/new)
with a description, the affected version (shown at the bottom of the sidebar) and steps to reproduce.

We aim to acknowledge reports within 3 working days and to ship a fix for confirmed issues as quickly as their
severity requires, crediting you in the release notes unless you'd rather stay anonymous.

## Supported versions

Security fixes go into the latest release. Pin `CONSOLE_VERSION` in production and update regularly.

## Hardening checklist for operators

- Keep `BACKUP_MASTER_KEY` and each workspace's **age** private key in a password manager, outside the server.
- Serve the console over HTTPS only; consider Cloudflare Tunnel + Access (`app/docker-compose.tunnel.yaml`).
- Use **S3 Object Lock** on at least one destination so backups survive stolen credentials.
- Give people the lowest role that works (Viewer / Operator) and review the audit log.
- Use read-only API tokens for monitoring, and turn API access off for workspaces that don't need it.

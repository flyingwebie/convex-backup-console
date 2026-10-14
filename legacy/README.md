# Legacy

`docker-compose.yaml` is the original all-in-one template: a self-hosted Convex instance **plus** the
[`orenaksakal/convex-self-hosted-backups`](https://github.com/orenaksakal/convex-self-hosted-backups) sidecar
and an `export-cleanup` job. It's kept so existing Coolify resources that deploy from it keep working, but it is no
longer developed.

**New projects:** use [`convex-instance.coolify.yaml`](../convex-instance.coolify.yaml) for the instance and the
[Convex Backup Console](../app/README.md) ([`backup-console.coolify.yaml`](../backup-console.coolify.yaml)) for
backups and restores of all your instances.

**Existing resources** that point Coolify at `/docker-compose.yaml`: change the Docker Compose Location to
`/legacy/docker-compose.yaml` to keep the current behaviour, or migrate:

1. Deploy the console and add the instance (its API URL + `./generate_admin_key.sh` output).
2. Create a job, run it once and check the backup appears.
3. Switch the resource to `/convex-instance.coolify.yaml` (same services, volumes and variables, minus `backups` and
   `export-cleanup`) and redeploy. Your data volumes are unchanged.

# Local end-to-end test kit

Runs the real instance template (Postgres + RustFS) twice, plus the console, on your machine.

```bash
# 1. Convex A (source) and B (restore target) from the root template
for n in a b; do
  docker compose -p convex-$n --env-file testing/local/.env.$n \
    -f docker-compose.yaml -f testing/local/compose.override.yaml up -d
  docker compose -p convex-$n exec -T backend ./generate_admin_key.sh | tail -1 > /tmp/cbc-key-$n
done

# 2. Seed A: 500 documents + 20 stored files (64 KB each, SHA-256 recorded)
cd testing/local/seed-app && npm i
export CONVEX_SELF_HOSTED_URL=http://localhost:3301 CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat /tmp/cbc-key-a)"
npx convex deploy -y && npx convex run seed:run '{"notes":500,"files":20}'
cd -

# 3. "R2" stand-in + console
docker network create cbc-net
docker run -d --name cbc-r2 --network cbc-net -p 9100:9000 \
  -e RUSTFS_ACCESS_KEY=r2key -e RUSTFS_SECRET_KEY=r2-secret-key rustfs/rustfs:1.0.0-rc.4 /data
docker run --rm --network cbc-net -e AWS_ACCESS_KEY_ID=r2key -e AWS_SECRET_ACCESS_KEY=r2-secret-key \
  -e AWS_REGION=us-east-1 amazon/aws-cli:2.36.34 --endpoint-url http://cbc-r2:9000 \
  s3api create-bucket --bucket convex-backups-test
docker build -t cbc-test backups
docker run -d --name cbc-app --network cbc-net --add-host=host.docker.internal:host-gateway \
  --read-only --tmpfs /tmp -v cbc-vol:/data -p 3078:3000 \
  -e BACKUP_MASTER_KEY=local-master-key -e BETTER_AUTH_SECRET=dev-secret-0123456789abcdefghijkl \
  -e PUBLIC_URL=http://localhost:3078 -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=correct-horse-battery \
  cbc-test
```

In the console (http://localhost:3078):
- Instance URLs: `http://host.docker.internal:3301` (A) and `:3302` (B).
- R2 stand-in: endpoint `http://cbc-r2:9000`, region `us-east-1`, bucket `convex-backups-test`, path-style on.
- Local destination: `/data/backups`.

Convex Cloud tests need a mock of `api.convex.dev` (`e2e/mock-convex-api.mjs`, run as container `cbc-bigbrain`):
run the console with `-e CONVEX_PROVISION_HOST=http://cbc-bigbrain:8080` and pass
`CLOUD_KEY="prod:self-hosted-convex|<secret part of A's admin key>"` to `e2e/e2e.mjs`.

Compare instances after a restore (run it against each one):

```bash
cd testing/local/seed-app
npx convex deploy -y && npx convex run seed:fingerprint && npx convex run seed:verifyFiles
```

Tear down:

```bash
docker rm -f cbc-app cbc-r2; docker volume rm cbc-vol; docker network rm cbc-net
for n in a b; do docker compose -p convex-$n down -v; done
```

`compose.override.yaml` publishes the API port and runs Convex's cleanup every 30s
(`SYSTEM_TABLE_CLEANUP_FREQUENCY_SECONDS`) so export purging shows up quickly. Don't use it in production.

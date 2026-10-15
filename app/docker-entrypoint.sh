#!/bin/sh
# Platforms like Railway, Render and Fly.io mount volumes owned by root. When started as root,
# make the data directory writable for the unprivileged "node" user, then drop to it.
# (The Coolify/compose templates start as "node" directly and skip this.)
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  find "$DATA_DIR" \! -user node -exec chown node:node {} + 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"

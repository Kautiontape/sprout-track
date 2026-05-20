#!/usr/bin/env bash
# Pull a snapshot of prod's database + env volumes from ktn into the LOCAL
# Docker volumes used by upstream's docker-compose.yml. Use this to seed a
# local dev instance with realistic data.
#
# Source volumes on ktn:    sprout-track_db-data, sprout-track_env-data
# Destination volumes here: sprout-track-db,      sprout-track-env
#                           (the explicit `name:` entries in upstream's compose)
#
# Stops any running local container first. Skips the `files` volume since it's
# empty in prod.
set -euo pipefail

TS=$(date +%Y%m%d-%H%M%S)
TMP="/tmp/sprout-track-snapshot-$TS"
mkdir -p "$TMP"

echo "==> tarring prod volumes on ktn..."
ssh ktn "mkdir -p $TMP && \
  for v in sprout-track_db-data sprout-track_env-data; do \
    docker run --rm -v \"\$v:/data:ro\" -v \"$TMP:/backup\" alpine \
      tar czf \"/backup/\${v}.tar.gz\" -C /data .; \
  done && \
  ls -lh $TMP"

echo "==> downloading to $TMP/ ..."
scp -q "ktn:$TMP/*.tar.gz" "$TMP/"

echo "==> stopping local container if running..."
cd "$(dirname "$0")/.."
docker compose -f docker-compose.yml down 2>/dev/null || true

echo "==> restoring into local volumes..."
for pair in "sprout-track_db-data:sprout-track-db" "sprout-track_env-data:sprout-track-env"; do
  src="${pair%:*}"
  dst="${pair#*:}"
  docker volume create "$dst" >/dev/null
  docker run --rm -v "$dst:/data" -v "$TMP:/backup:ro" alpine sh -c \
    "rm -rf /data/..?* /data/.[!.]* /data/* 2>/dev/null; tar xzf /backup/${src}.tar.gz -C /data"
  echo "  restored -> $dst"
done

echo "==> cleaning up tmp dirs..."
ssh ktn "rm -rf $TMP"
rm -rf "$TMP"

echo
echo "Snapshot restored. Start local dev with: ./ktn-scripts/local-up.sh"

#!/usr/bin/env bash
# Refresh ./db/ (the non-Docker hot-reload dev flow) with a fresh snapshot of
# prod's database volume from ktn. Companion to pull-prod-snapshot.sh, which
# does the same for the local Docker volumes.
#
#   ./ktn-scripts/refresh-local-db.sh
#
# - Backs up the current ./db/*.db files first (timestamped .bak).
# - Applies any pending prisma migrations afterwards, so a local branch that's
#   ahead of prod's schema (new columns etc.) keeps working.
# - No secrets live here: ENC_HASH and DATABASE_URL stay in the gitignored .env.
# - Restart `npm run dev` afterwards if it was running — it holds open handles
#   to the old database file.
set -euo pipefail

cd "$(dirname "$0")/.."

TS=$(date +%Y%m%d-%H%M%S)
TMP="/tmp/sprout-track-dbrefresh-$TS"

echo "==> tarring prod db volume on ktn..."
ssh ktn "mkdir -p $TMP && \
  docker run --rm -v sprout-track_db-data:/data:ro -v $TMP:/backup alpine \
    tar czf /backup/db-data.tar.gz -C /data . && \
  ls -lh $TMP"

echo "==> downloading..."
mkdir -p "$TMP"
scp -q "ktn:$TMP/db-data.tar.gz" "$TMP/"

echo "==> backing up current ./db/ ..."
mkdir -p db
for f in db/*.db; do
  [ -e "$f" ] && cp "$f" "$f.pre-refresh-$TS.bak"
done

echo "==> extracting into ./db/ ..."
tar xzf "$TMP/db-data.tar.gz" -C db/

echo "==> applying pending migrations to the fresh snapshot..."
npx prisma migrate deploy

echo "==> cleaning up tmp dirs..."
ssh ktn "rm -rf $TMP"
rm -rf "$TMP"

echo
echo "Done. Local ./db/ now matches prod (plus local migrations)."
echo "Old copies kept as db/*.pre-refresh-$TS.bak — delete when confident."
echo "Restart the dev server if it was running."

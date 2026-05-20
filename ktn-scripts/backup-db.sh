#!/usr/bin/env bash
# Snapshot all three prod volumes (db, env, files) to /tmp on ktn and mirror to
# /tmp on this laptop. Run before risky operations (major upstream sync,
# schema-touching changes, etc.). Backups are throw-away once you've confirmed
# the change is working.
set -euo pipefail

TS=$(date +%Y%m%d-%H%M%S)
BD=/tmp/sprout-track-backup-$TS

ssh ktn "mkdir -p $BD && \
  for v in sprout-track_db-data sprout-track_env-data sprout-track_files; do \
    docker run --rm -v \"\$v:/data:ro\" -v \"$BD:/backup\" alpine \
      tar czf \"/backup/\${v}.tar.gz\" -C /data . ; \
  done && \
  ls -lh $BD"

mkdir -p "$BD"
scp -q "ktn:$BD/*.tar.gz" "$BD/"

echo
echo "Backup on ktn:    $BD"
echo "Backup on laptop: $BD"
echo "To clean up:      ssh ktn rm -rf $BD && rm -rf $BD"

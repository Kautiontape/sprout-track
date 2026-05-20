#!/usr/bin/env bash
# Build and start a LOCAL instance using upstream's docker-compose.yml only
# (does NOT load docker-compose.ktn.yml). Local volumes are isolated from prod:
# they live under names like sprout-track-db / sprout-track-env (see upstream
# compose's `volumes:` block).
#
# Pre-populate with prod data via ./pull-prod-snapshot.sh before running.
set -euo pipefail
cd "$(dirname "$0")/.."

# Force BuildKit on for the cache mounts in Dockerfile to work
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
echo
echo "Local app: http://localhost:3000"

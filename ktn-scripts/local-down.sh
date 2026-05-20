#!/usr/bin/env bash
# Stop the local container. Add --volumes (or -v) to also drop local volumes
# and start fresh on the next ./local-up.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose -f docker-compose.yml down "$@"

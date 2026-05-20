#!/usr/bin/env bash
# Follow live container logs on ktn. Ctrl-C to stop.
set -euo pipefail

exec ssh ktn 'docker logs -f --tail 100 sprout-track'

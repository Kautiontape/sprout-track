#!/usr/bin/env bash
# Manually trigger the deploy workflow without pushing a commit. Useful when
# you've changed something on ktn directly (e.g. compose env) and want to
# rebuild from the current origin/main.
set -euo pipefail

gh workflow run deploy-ktn.yml --repo Kautiontape/sprout-track --ref main
echo "Triggered. Tail with: ./ktn-scripts/logs.sh"

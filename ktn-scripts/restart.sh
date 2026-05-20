#!/usr/bin/env bash
# Restart the prod container in place (no rebuild). Use when env or config
# changes need to take effect without a code change.
set -euo pipefail

ssh ktn 'cd /opt/services/sprout-track && docker compose restart'
ssh ktn 'docker ps --filter name=sprout-track --format "{{.Status}}"'

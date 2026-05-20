#!/usr/bin/env bash
# Pull the latest commits from Oak-and-Sprout/sprout-track and replay our ktn
# customizations on top. Force-pushes to origin; the deploy workflow then
# redeploys on ktn automatically.
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch upstream
git rebase upstream/main
git push --force-with-lease origin main

echo
echo "Sync complete. Deploy workflow should fire on the push."
echo "Watch it: gh run watch --repo Kautiontape/sprout-track \$(gh run list --repo Kautiontape/sprout-track --limit 1 --json databaseId -q '.[0].databaseId')"

#!/usr/bin/env bash
# Merge one upstream release tag into a sync branch, then stop for verification.
#
# We fork Oak-and-Sprout/sprout-track. Upstream releases are merged ONE TAG AT A
# TIME onto a sync branch, never rebased and never force-pushed. See
# documentation/upstream-sync.md for the conflict recipes and the reasoning.
#
#   ./ktn-scripts/sync-upstream.sh            # list tags newer than HEAD
#   ./ktn-scripts/sync-upstream.sh 1.6.6      # merge that one tag, then stop
#
# This script deliberately does NOT push, does NOT touch main, and does NOT
# force anything. A push to main auto-deploys to ktn and the container migrates
# the live database on startup, so that step stays manual and deliberate.
#
# Superseded the previous rebase + force-push implementation, which could not
# survive a large divergence and pushed straight to production.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Adding 'upstream' remote..."
  git remote add upstream https://github.com/Oak-and-Sprout/sprout-track.git
fi

echo "==> fetching upstream..."
git fetch upstream --tags --quiet

if [ $# -eq 0 ]; then
  echo
  echo "Upstream tags not yet merged into HEAD:"
  for tag in $(git tag --list --sort=v:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$'); do
    if ! git merge-base --is-ancestor "$tag" HEAD 2>/dev/null; then
      printf '  %-10s %s\n' "$tag" "$(git log -1 --format=%as "$tag")"
    fi
  done
  echo
  echo "Merge the OLDEST one first:  $0 <tag>"
  exit 0
fi

TAG="$1"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || {
  echo "error: no such upstream tag '$TAG'" >&2
  exit 1
}

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "main" ]; then
  echo "error: refusing to merge onto main. Create a sync branch first:" >&2
  echo "  git checkout -b sync/upstream-$TAG" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty. Commit or stash first." >&2
  exit 1
fi

echo "==> backing up the local dev database..."
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f db/baby-tracker.db ] && cp db/baby-tracker.db "db/baby-tracker.db.pre-${TAG}-${STAMP}.bak"

echo "==> merging upstream $TAG into $BRANCH..."
git merge "$TAG" --no-commit --no-ff || true

CONFLICTS=$(git diff --name-only --diff-filter=U)
if [ -n "$CONFLICTS" ]; then
  echo
  echo "Conflicts to resolve:"
  echo "$CONFLICTS" | sed 's/^/  /'
  echo
  echo "Recipes (documentation/upstream-sync.md):"
  echo "  translations   node scripts/merge-locale-conflict.js && node scripts/check-missing-translations.js"
  echo "  nursery-mode   git checkout MERGE_HEAD -- src/components/features/nursery-mode app/api/nursery-mode-settings"
  echo "  Dockerfile     keep ours, hand-port upstream: git diff <prev-tag> $TAG -- Dockerfile"
  echo "  schema.prisma  union; keep our PottyLog + baby config fields; npx prisma validate"
  echo "  security       upstream's behavior wins"
else
  echo "Merged cleanly, nothing to resolve."
fi

cat <<EOF

Next:
  1. Resolve any conflicts above, then: git add -A
  2. Verify:  npx tsc --noEmit && npm run build && npm run test
  3. Dry-run migrations against a copy, never the real database:
       cp db/baby-tracker.db db/sync-test.db
       sed 's|url      = "file:../db/baby-tracker.db"|url      = "file:../db/sync-test.db"|' \\
         prisma/schema.prisma > prisma/sync-test.prisma
       npx prisma migrate deploy --schema=prisma/sync-test.prisma
  4. git commit -m "sync: Merge upstream $TAG"
  5. Repeat for the next tag. Merge to main only when the ladder is finished,
     and run ./ktn-scripts/backup-db.sh BEFORE that push -- the container
     migrates the live database on startup with no backup of its own.
EOF

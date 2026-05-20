# Local Customizations (ktn fork)

Tracks every divergence from upstream `Oak-and-Sprout/sprout-track`. Review on each
upstream rebase to decide whether each item is still needed.

## Infra

- **`docker-compose.ktn.yml`** — Pins port to `127.0.0.1:8109`, sets production
  env (TZ, COOKIE_SECURE, APP_URL, ROOT_DOMAIN), and pins volume names to the
  pre-fork production names (`sprout-track_db-data`, `sprout-track_env-data`,
  `sprout-track_files`) so existing data attaches. **Not** named
  `docker-compose.override.yml` on purpose: that would auto-load locally and
  silently apply prod settings to dev.
- **`.github/workflows/deploy-ktn.yml`** — Self-hosted runner on ktn, deploys
  on push to `main` via `git fetch` + `git reset --hard` + `docker compose -f
  docker-compose.yml -f docker-compose.ktn.yml up -d --build`. Skips redeploy
  on docs/script-only changes via `paths-ignore`.
- **`ktn-scripts/`** — Operational helpers (sync, deploy, logs, restart,
  backup) and local-dev helpers (pull prod snapshot, up/down). See
  `ktn-scripts/README.md`.

## Build

- **`next.config.js`** — Disables TypeScript and ESLint during `next build`.
  The 2 GB-RAM build host OOMs on the default Next.js prod build (TypeScript
  pass is the worst offender). Run them separately with `npx tsc --noEmit`
  and `npm run lint` before pushing.
- **`Dockerfile`** — Three small patches:
  - `# syntax=docker/dockerfile:1.7` at top → enables `--mount=type=cache`.
  - `--mount=type=cache,target=/root/.npm` on `RUN npm ci` → ~65s → ~5s warm.
  - `--mount=type=cache,target=/app/.next/cache` on `RUN npm run build`.
  - `ENV NODE_OPTIONS=--max-old-space-size=1024` before build (with TS/lint
    off, 1 GB is comfortable headroom).
  These are the only edits to upstream files; everything else is in new files
  to keep rebases clean.
- **`.dockerignore`** — Excludes `ktn-scripts/`, `KTN_CHANGES.md`, `TODO.md`,
  `docker-compose.ktn.yml` from the build context so docs-only changes don't
  invalidate the `COPY . .` layer cache.

## Sync workflow

```
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin main
```

Or just `./ktn-scripts/sync-upstream.sh`.

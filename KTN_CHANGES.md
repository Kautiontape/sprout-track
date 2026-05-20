# Local Customizations (ktn fork)

Tracks every divergence from upstream `Oak-and-Sprout/sprout-track`. Review on each
upstream rebase to decide whether each item is still needed.

## Infra

- **`docker-compose.override.yml`** — Pins port to `127.0.0.1:8109`, sets
  production env (TZ, COOKIE_SECURE, APP_URL, ROOT_DOMAIN), and overrides volume
  names to the pre-fork production names (`sprout-track_db-data`,
  `sprout-track_env-data`, `sprout-track_files`) so existing data attaches.
- **`.github/workflows/deploy-ktn.yml`** — Self-hosted runner on ktn, deploys on
  push to `main` via `git fetch` + `git reset --hard` + `docker compose up -d --build`.

## Dockerfile

- **`ENV NODE_OPTIONS=--max-old-space-size=2048`** before `npm run build`. ktn has
  only 2 GB RAM; Next.js's TypeScript pass OOMs at the default ~1 GB heap. With
  2 GB of swap available the build spills but completes. Revisit if upstream
  reworks the build step (rebase conflict candidate).

## App

(none yet)

## Sync workflow

```
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin main
```

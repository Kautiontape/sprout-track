# ktn-scripts

Helpers for operating this fork against the ktn deploy. Each script is
runnable from anywhere in the repo (they `cd` into the repo root themselves).

**Prod ops**

| Script                | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `sync-upstream.sh`    | Rebase `main` on `upstream/main`, force-push, deploy fires automatically.   |
| `deploy.sh`           | Manually re-run the deploy workflow without pushing a new commit.           |
| `logs.sh`             | Tail live container logs on ktn.                                            |
| `restart.sh`          | Restart the prod container in place (no rebuild). For env changes.          |
| `backup-db.sh`        | Snapshot all three volumes to `/tmp` on ktn + this laptop. Before risky ops.|

**Local dev**

| Script                   | What it does                                                                |
| ------------------------ | --------------------------------------------------------------------------- |
| `pull-prod-snapshot.sh`  | Pull prod DB + env into LOCAL volumes (isolated, named `sprout-track-db`).  |
| `local-up.sh`            | Build + start a local instance using only upstream's `docker-compose.yml`.  |
| `local-down.sh`          | Stop the local container. Pass `--volumes` to wipe local data.              |

Typical local dev flow:
```
./ktn-scripts/pull-prod-snapshot.sh    # one-time, or whenever you want fresh data
./ktn-scripts/local-up.sh              # http://localhost:3000
```

Local compose loads only `docker-compose.yml` — production overrides in
`docker-compose.ktn.yml` are NOT applied, so local volumes / ports / env are
isolated from prod.

Background and conventions live in `../KTN_CHANGES.md`.

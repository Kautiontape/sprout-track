# ktn-scripts

Helpers for operating this fork against the ktn deploy. Each script is
runnable from anywhere in the repo (they `cd` into the repo root themselves).

| Script                | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `sync-upstream.sh`    | Rebase `main` on `upstream/main`, force-push, deploy fires automatically.   |
| `deploy.sh`           | Manually re-run the deploy workflow without pushing a new commit.           |
| `logs.sh`             | Tail live container logs on ktn.                                            |
| `restart.sh`          | Restart the prod container in place (no rebuild). For env changes.         |
| `backup-db.sh`        | Snapshot all three volumes to `/tmp` on ktn + this laptop. Before risky ops.|

Background and conventions live in `../KTN_CHANGES.md`.

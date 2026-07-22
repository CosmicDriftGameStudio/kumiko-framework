---
"@cosmicdrift/kumiko-framework": minor
---

`kumiko schema validate` gets a third, DB-free check: `replayMigrationsDir` replays every committed `kumiko/migrations/*.sql` file's `CREATE`/`ALTER`/`DROP TABLE` statements (reusing the runner's own statement-splitting) and `diffReplayAgainstSnapshot` diffs the reconstructed schema against `.snapshot.json`. Catches a migration file whose SQL body silently drifts from what its own filename/snapshot entry claims — e.g. an accidental copy-paste from an earlier migration, where the snapshot stays correct but the SQL never actually creates the table it's supposed to. Runs automatically as part of the existing `kumiko-schema validate` CI step, no per-app wiring needed.

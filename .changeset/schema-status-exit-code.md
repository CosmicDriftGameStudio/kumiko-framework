---
"@cosmicdrift/kumiko-framework": minor
---

schema CLI: `status` now exits non-zero when migrations are pending.

`runSchemaCli` `status` (and the `kumiko-schema` bin that wraps it) previously
always exited `0`. It now returns `1` when there are pending migrations and `0`
when the database is up to date, so `bunx kumiko-schema status` can gate CI
("fail the pipeline if the schema drifted from the migrations"). Existing scripts
that only inspected the printed output are unaffected; scripts that branched on
the exit code of `status` will now see a non-zero code while migrations are pending.

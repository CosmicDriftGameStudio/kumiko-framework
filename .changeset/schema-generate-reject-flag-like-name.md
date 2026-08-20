---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko-schema generate` no longer treats `--help`/`-h` or any other flag-like value as the migration name. `generate --help`/`-h` now prints usage and exits 0 without writing anything; a name starting with `-` or containing characters outside `[A-Za-z0-9_-]` (e.g. `../../x`) is rejected with an error instead of being written into `kumiko/migrations/<seq>_<name>.sql` and `.snapshot.json`.

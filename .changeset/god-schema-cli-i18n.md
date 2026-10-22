---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-guards": patch
---

`kumiko-schema` and the standalone `kumiko schema apply` bundle print all of their messages in English now. The remaining German lines (missing schema file or migrations folder, unknown subcommand, the help text, the generate hints, the standalone apply progress lines) were translated. `runSchemaCli()` dispatches each subcommand through a table to its own handler, and `requiredKeysFromScreen()` collects keys through one collector per screen kind.

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko-schema output in English, schema CLI and screen key collection split per kind
detail: Visible change: kumiko-schema (and the dev `kumiko schema` command) now prints "is missing", "App convention", "No schema changes detected — no new migration file written.", "Review, hand-edit if needed, then git add + commit.", "is missing — run schema generate <name> first.", "No kumiko/migrations/ — the app is still on the legacy drizzle path.", "Unknown subcommand" / "Allowed", "must declare `export const ENTITY_METAS: EntityTableMeta[]`" and an English help text instead of the German lines. The standalone `kumiko schema apply` of production bundles prints "Creating framework infrastructure tables (idempotent)…", "Applying kumiko migrations (…)…", "… is missing — kumiko/migrations/ must be part of the image." and "Unknown command: kumiko … / The standalone bundle only supports 'kumiko schema apply'.". Scripts that matched the German text need the English one. Exit codes, the order of the output lines and which lines go to stderr are unchanged. runSchemaCli() keeps its signature; each subcommand lives in its own file under schema-cli/. requiredKeysFromScreen() returns the same keys in the same order; a screen with an unknown type (only reachable through a cast) yields just its title key.
-->

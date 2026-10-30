---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
---

projectionDetail metrics accept a `format`, and the migration replay no longer reads a table name ending in `as` as `CREATE TABLE ... AS`.

<!-- kumiko-changes
feature: renderer
type: improvement
title: projectionDetail metrics can be formatted
detail: `metrics[].format` takes a `FormatSpec` such as `{ format: "date" }`. The metric shows the formatted value (an empty result falls back to the raw text); the tone still resolves on the raw value. Without `format` nothing changes.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Migration replay keeps tables whose name ends in "as"
detail: `CREATE TABLE IF NOT EXISTS "read_themas" (...)` was parsed as `CREATE TABLE read_them AS ...`, so `kumiko-schema validate` reported content drift for `read_them` and `read_themas`. `AS` now needs a column list or whitespace before it.
-->

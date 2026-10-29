---
"@cosmicdrift/kumiko-framework": patch
---

Boot accepts `count: true` on a relatedList whose query schema is `.strict()`, and the app biome preset points at the 2.6.3 schema.

<!-- kumiko-changes
feature: framework
type: fix
title: count badge works with strict query schemas; biome preset schema 2.6.3
detail: The boot check for a relatedList with `count: true` treated every Zod object with a catchall as having open keys and skipped the `limit` and `totalCount` lookup, so a query declared with `.strict()` (catchall `never`) failed boot although it accepts both keys. Only a catchall other than `never` now counts as open; `.loose()` and `.catchall()` schemas still fail the check. The `@cosmicdrift/kumiko-framework/biome` preset references the 2.6.3 configuration schema, which removes the schema mismatch notice in apps on Biome 2.6.
-->

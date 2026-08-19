---
"@cosmicdrift/kumiko-bundled-features": patch
---

fw#2230: `user-session:list` (the `session-list` admin screen) had an empty input schema, so the list was always `createdAt desc` with no `sortable` capability. The query now accepts `sort`/`sortDirection`/`limit`; `sort` is checked against a column allowlist (`id`, `userId`, `createdAt`, `expiresAt`, `revokedAt`) before being used in `selectMany`'s `orderBy`, falling back to `createdAt desc` for anything else. No pager: `SelectOptions` has no `offset`/`COUNT(*)`, so `cursor`/`offset` stay out of the schema.

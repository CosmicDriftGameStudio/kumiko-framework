---
"@cosmicdrift/kumiko-framework": patch
---

Fix `event-store-executor.list()` keyset pagination against a custom `sort` field. The cursor boundary was always `id > cursor`, but rows are ordered by `<sort> <dir>, id ASC` — pages after the first duplicated and permanently skipped rows whenever a caller passed `sort`/`sortDirection`. The cursor now encodes both the sort value and the id, and the WHERE boundary follows the same direction and Postgres NULLS-default ordering as the `ORDER BY` clause. Old id-only cursors already in flight from clients are still accepted and fall back to the previous id-only boundary.

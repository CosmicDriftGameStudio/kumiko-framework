---
"@cosmicdrift/kumiko-framework": patch
---

fw#2198: `executor.list` never guaranteed a stable row order — with `sort` set there was no tie-breaker for equal sort values, and without `sort` there was no `ORDER BY` at all, so offset and cursor paging could skip or duplicate rows across pages. The generated SQL now always appends `"id" ASC` as a tie-breaker (or as the sole sort key when no `sort` is given), making paging deterministic.

---
"@cosmicdrift/kumiko-renderer": patch
---

fw#2216: `ProjectionListBody` read `rowsQuery.data?.rows ?? []` and silently rendered an empty table for any query handler response that wasn't a `{ rows, nextCursor }` envelope — a bare array, HTTP 200, empty table, no error. This is exactly what hid the `/session-list` bug in #2216. The renderer now checks the resolved response's `rows` field and, when it isn't an array, renders an error banner naming the screen and query instead of falling through to an empty list.

---
"@cosmicdrift/kumiko-framework": patch
---

List reads are now capped: `eventStore.list()` (and the shared executor list path) clamp `limit` through a new `resolveListPagination()` — a non-numeric or missing `limit` falls back to the 25-item default, negatives are rejected, and any `limit` above `MAX_LIST_LIMIT` (200) is clamped instead of passed through as raw SQL. Previously a caller-supplied `?limit=` string was interpolated into the `LIMIT` clause unvalidated, which both allowed oversized result sets and let a crafted numeric-looking value inject SQL. Apps that intentionally page beyond 200 rows must loop with `offset` instead.

Schema-definition boundaries now reject unbranded `{ kind: "sql-expr", text }` objects outright: `dialect.sql()` and `column.default()` no longer treat a duck-typed object that merely *looks* like a `SqlExpression` as one — it is quoted as a JSON value instead of spliced into DDL/query text. Only expressions created through the framework's `sql()`/branded helpers carry the brand check now enforced in `literalDefault()`, `dialect.sql()`, and `sqlExpressionText()` (entity-table-meta). A request-supplied or persisted payload that mimics the shape can no longer fake a raw-SQL literal.

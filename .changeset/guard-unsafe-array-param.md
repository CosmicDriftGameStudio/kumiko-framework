---
"@cosmicdrift/kumiko-guards": minor
---

New guard that warns about array parameters in `.unsafe()` calls, which Bun.SQL binds wrongly on Linux.

<!-- kumiko-changes
feature: guards
type: improvement
title: Guard against array parameters in .unsafe()
detail: The Unsafe Array Param guard warns when a `.unsafe(sql, [...])` parameter list holds an array literal or a spread. Bun.SQL binds such an array as "a,b" on Linux, so `ANY($n)` fails only in CI and passes on macOS; pass `toPostgresArrayLiteral(values)` with a `$n::text[]` cast. It is a warning and cannot see array-typed variables. Measured on 2026-10-23: no hit in any consumer repo.
-->

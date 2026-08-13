---
"@cosmicdrift/kumiko-bundled-features": patch
---

The `jobs` feature's `list`, `details`, and `retry` handlers now read/write through `ctx.systemDb.acknowledgeCrossTenant("cross-tenant job monitoring")` instead of `ctx.db` directly (fw#2077, part of fw#2056's fail-closed `systemScope()` migration). Behavior is unchanged — these handlers are intentionally platform-wide, unscoped job monitoring by `runId` — the change makes that cross-tenant intent explicit and self-documenting instead of implicit in `ctx.db`'s already-unfiltered "system" mode.

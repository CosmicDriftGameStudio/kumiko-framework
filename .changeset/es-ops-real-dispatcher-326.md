---
"@cosmicdrift/kumiko-framework": patch
---

test(es-ops): refactor seed-migration integration tests onto a real dispatcher

The `runner`/`context` es-ops integration tests built a fake dispatcher via
`makeMockDispatcher` (bun:test `mock()`), violating the no-fake-dispatcher rule
— both were grandfathered into `MOCK_GUARD_ALLOWLIST`. They now boot a real
`createDispatcher` with a real feature (mirroring the boot-time seed path in
`run-prod-app`, which calls `dispatcher.write` directly — no HTTP route) and
assert against real event-store rows. The two allowlist entries are removed.

Also corrects a misleading tx-isolation comment in the seed-migration context
builder: `systemWriteAs` writes run in the dispatcher's own transaction on
`context.db` and survive a runner rollback (hence seeds must be idempotent) —
they are not nested as a savepoint that rolls back with the runner tx. This is
now verified by the `dispatcher-writes vor throw bleiben committed` test.

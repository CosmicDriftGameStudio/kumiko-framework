---
"@cosmicdrift/kumiko-guards": minor
---

New `test-es-fixtures` guard: tests may not write `kumiko_events` or create `read_tenant_memberships` by hand-written SQL.

<!-- kumiko-changes
feature: guards
type: improvement
title: Guard against hand-made event and membership SQL in tests
detail: Flags INSERT INTO / UPDATE kumiko_events and CREATE TABLE read_tenant_memberships in test files. Seed through append() or runSeedWritesAt() and unsafeCreateEntityTable with seedRow instead. Perf bulk seeds and the ordering tests that hold a transaction open are allowlisted.
-->

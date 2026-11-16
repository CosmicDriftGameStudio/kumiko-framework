---
"@cosmicdrift/kumiko-guards": patch
---

The integration-test mock guard moved into kumiko-guards, and guards.md lists the Biome plugins.

<!-- kumiko-changes
feature: guards
type: improvement
title: guard-integration-mocks check in kumiko check, Biome plugins in guards.md
detail: Mock calls (`mock(`, `spyOn(`, `mock.module`, `vi.*`, `jest.*`) in `*.integration.test.ts` and `*.integration.ts` are now a repo check of `kumiko check` and run in every repo, not only through the framework's own `integration.guard.ts`. Counts are frozen per file in `.kumiko-integration-mocks-baseline.json` instead of a hand-kept allowlist; without the file the check only warns. Freeze once with `kumiko-guards checks --write-baseline --guard=guard-integration-mocks`. The generated `docs/reference/guards.md` gains a Biome plugins table with purpose and scope per plugin.
-->

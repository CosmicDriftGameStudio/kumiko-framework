---
"@cosmicdrift/kumiko-samples": patch
"@cosmicdrift/kumiko-framework": patch
---

Sample tests no longer create entity and event tables by hand.

<!-- kumiko-changes
feature: samples
type: improvement
title: Sample tests rely on setupTestStack for their tables
detail: `setupTestStack` creates the `r.entity` tables of the features it gets and the events table, so the sample integration tests drop their `unsafeCreateEntityTable` and `createEventsTable` calls and the generated `agents/examples/*.md` no longer show them. A lint rule in the framework repo rejects both imports in `samples/**/__tests__`, except in the recipes that build their database without the test stack. The framework AGENTS.md names those recipes instead of listing the helpers.
-->

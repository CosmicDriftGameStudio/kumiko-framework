---
"@cosmicdrift/kumiko-framework": patch
---

Recipe integration tests isolate per tenant instead of raw DELETE FROM resets

<!-- kumiko-changes
feature: framework
type: improvement
title: Recipe integration tests isolate per tenant instead of raw DELETE FROM resets
detail: The recipe integration tests that agents learn from no longer reset tables with raw DELETE FROM statements. Each test now runs in its own tenant with its own users, or uses unique ids. The kumiko-schema-check header comment is now English. No runtime change.
-->

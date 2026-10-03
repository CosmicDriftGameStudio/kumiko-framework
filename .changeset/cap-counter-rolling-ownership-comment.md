---
"@cosmicdrift/kumiko-bundled-features": patch
---

cap-counter: corrected the documented reason why rolling cap booking still needs a `SystemAdmin` identity. The event-ownership check only guards `appendDomainEventCore`, not the entity-executor path, so the earlier "ownership rule rejects in-process appends" wording was inaccurate. Behavior is unchanged.

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: corrected the documented reason rolling cap booking needs SystemAdmin
migration: |
  No action needed: behavior is unchanged.
-->

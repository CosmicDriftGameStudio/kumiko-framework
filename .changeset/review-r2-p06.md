---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes: the step-dispatcher deliver job rejects an invalid payload at the trigger instead of burning its retries, the collection-refused and tier-assignment-source guards are type predicates built on isOneOf, and the stale-customer, locale-title, copy-locale and test-mail behaviors are covered by tests.

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: Deliver job validates its payload at the trigger
detail: The deliver job now declares its payload schema, so a manual trigger with an invalid payload is rejected up front instead of throwing inside the handler and consuming all retries.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: isCollectionRefusedKind is a type predicate
detail: isCollectionRefusedKind accepts unknown and narrows to the refused kinds; tier-engine's isTierAssignmentSource shares the isOneOf implementation. Behavior is unchanged.
-->

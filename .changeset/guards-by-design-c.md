---
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-testing": minor
---

The Unsafe-Append-Event guard is removed because the event store enforces the same rules at runtime.

<!-- kumiko-changes
feature: guards
type: improvement
title: Unsafe-Append-Event guard removed
detail: The event store rejects unregistered event types and validates every payload against its schema at runtime, for appendEvent and unsafeAppendEvent alike, so the static guard is redundant.
migration: Delete `.kumiko-unsafe-append-event-baseline.json`.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: Access-Denied-Test guard replaced by a contract test helper
detail: Roles are checked centrally before the payload is parsed. The new `expectRoleRestrictedHandlersDenyForeignRole` test helper proves this over HTTP for every role-restricted write and query handler, so the guard that searched for a matching test per handler is removed.
migration: In an app integration test with setupTestStack and the app features, call `expectRoleRestrictedHandlersDenyForeignRole(stack)` and remove the "Access-Denied-Test Guard" entry from `.kumiko-security-baseline.json`.
-->

---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-types": minor
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

<!-- kumiko-changes
feature: guards
type: improvement
title: i18n-Keys guard no longer checks locales
detail: The guard only reports keys that are used without a definition. Locale completeness moved to the boot validator, which sees the real registered translations of every feature.
migration: Delete `src/i18n-guard-locales.ts` if it exists.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot fails when a feature leaves a locale out of some of its translation keys
detail: Within one feature, every translation key must carry every locale that any key of the same feature carries. A missing locale or an empty string fails boot with one error listing all gaps. Features with a single locale across all keys are unaffected, as are locale packages. A plural object counts as present.
migration: Add the missing locale to each listed key, or move that locale out of the feature into a locale package.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: PII-Annotations guard removed
detail: Entity text and longText fields now have to declare their personal stance by type and at boot, so the static guard that searched for unannotated fields is redundant.
migration: Delete `.kumiko-pii-annotations-baseline.json`.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: Entity text fields must declare a personal stance
detail: FieldsMap requires the personal stance of text and longText fields by type, and boot throws for such a field without one. The name heuristic for PII-typical names stays a warning and only applies to other field types.
migration: Move raw `{ type: "text" }` and `{ type: "longText" }` entity fields to createTextField / createLongTextField with `personal` ("self", "tenant", "ref", `{ of }`, or false with a `reason`). tsc shows each place.
-->

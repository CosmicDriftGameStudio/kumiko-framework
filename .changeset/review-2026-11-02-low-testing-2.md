---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

E2E helpers report the real cause of a failed MFA or login step, app projects with their own `testIgnore` keep the real and screenshot spec ignores, and `seedRowViaEventStore` rejects keys that are not entity fields.

<!-- kumiko-changes
feature: testing
type: fix
title: stricter and clearer test helpers
detail: `loginViaUi` throws with the MFA verify status and body, or names the missing post-login redirect. `defineAppE2eConfig` merges the default ignores into app projects that set `testIgnore` even without `isolatedSpecs`. `seedRowViaEventStore` throws for system columns such as `isDeleted`; use `deleteRowViaEventStore` or the real command. The unused `end` member of `RawDbClient` is gone.
migration: Replace seeds with system columns by the real event, for example `softDeleteUserViaEventStore` instead of `isDeleted: true`.
-->

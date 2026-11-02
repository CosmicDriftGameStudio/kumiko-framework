---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Review fixes: embedded-list comparisons ignore key order, the nested-write parent check no longer applies sub-field write roles, webhook payloads must not let undeclared keys through, a preSave wiring violation is reported once, named list filters accept row-meta columns, and a failing event read holds only its tenant in the search consumer.

<!-- kumiko-changes
feature: review-fixes
type: fix
title: embedded diff, webhook payload strictness, named filter columns, search tenant isolation
detail: `isUnchangedValue` compares key-order-stable, so unchanged embedded lists no longer re-trigger `requiredWhen` or sub-field write checks. The nested-write parent ownership check skips embedded sub-field role checks. `defineWebhookEvent` now throws (`webhook-event/payload-open-shape`) for payload objects declared as looseObject, passthrough or catchall, which would let undeclared keys reach receivers. `validateBoot` no longer reports the preSave wiring violation twice. Named list filter conditions may target row-meta columns such as `insertedById`. The search consumer holds a tenant whose event read fails instead of failing the whole batch. The user-scope seed error message names the literal seed form.
-->

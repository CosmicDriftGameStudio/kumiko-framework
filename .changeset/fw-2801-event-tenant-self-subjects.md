---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

fw#2801 step 2: `r.defineEvent(...).piiFields` can now declare a `tenant` or `self` (record) subject, not just a user subject: `{ <field>: { personal: "tenant" } }` encrypts under the event's own `tenantId`, `{ <field>: { personal: "self" } }` under `record:<aggregateType>:<aggregateId>`. Both the live-append path (`encryptEventPayloadPii`) and `backfillEventPiiEncryption`'s custom-event-catalog branch resolve the declared subject through the same `resolveEventSubject` (`@cosmicdrift/kumiko-framework/crypto`), so a catalogued field always encrypts under the identical subject key regardless of which of the two write paths produced it.

**Breaking:** `encryptEventPayloadPii(eventType, payload)` now requires a third argument, `envelope: { tenantId, aggregateType, aggregateId }` — needed to resolve `tenant`/`self` subjects. `append()` (the only framework call site) already supplies it from the appended event; direct callers of `encryptEventPayloadPii` must pass it too.

`validateEventPiiFields` no longer requires an owner field for `tenant`/`self` subjects — only that the declared PII field itself exists on the payload schema.

**Breaking:** `subjectKeyForRecord` (`@cosmicdrift/kumiko-framework/crypto`) now validates `entity` against `RECORD_ENTITY_PATTERN` (`/^[A-Za-z][A-Za-z0-9_-]*$/`, exported next to it) instead of only rejecting `""`/`":"`. This closes a gap where a `personal: "self"` event subject (or any `recordOwned` field) could mint a `record:<entity>:<id>` key for an entity name that `forgetSubject`'s `subjectIdSchema` would never accept — encrypted but permanently unshreddable. A consumer minting record subjects for an entity/aggregate-type name outside this pattern (leading digit/underscore, dots, etc.) will now get a loud `SubjectResolutionError`/thrown error at encrypt time instead of a silent future dead end. All entity names currently registered across the bundled features satisfy the pattern.

---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`personal: { of, whenAbsent: "self" }` encrypts rows without an owner under the row's own record key, so a record-forget shreds them

<!-- kumiko-changes
feature: framework
type: improvement
title: whenAbsent "self" keys ownerless personal fields on the record instead of the tenant
detail: |
  A personal field with a nullable owner can now declare `personal: { of: "ownerId", whenAbsent: "self" }` (entity fields and `defineEvent` piiFields). While the owner is empty, the value is encrypted under `record:<entity>:<id>`, the same subject as `personal: "self"` on events and `personal: { of: "id" }` on entities. `forget-subject` on that record then erases the value, its blind index and its search document; with `"tenant"` the value stayed readable until the tenant was destroyed. A row can mix subjects: the ciphertext names its key inline, so owner-keyed, tenant-keyed and record-keyed fields decrypt side by side.

  The boot validator accepts "self" next to "tenant" and rejects it on `idType: "serial"` entities, because a forget-subject request needs a UUID record id. Owner transitions behave as for "tenant": when an update assigns an owner (absent to X) the value moves from the record key to the user key; the created event stays record-keyed. The data-retention hardDelete also erases the record key of an ownerless "self" row; a row with an owner keeps its owner key.
migration: |
  Switching an existing field from `whenAbsent: "tenant"` to `"self"` changes only new writes. Events and rows written earlier stay tenant-keyed (still readable) until the PII event backfill re-keys them. The backfill fingerprint is bumped (`owner-rekey-v2`), so the boot-time backfill runs one more full pass: tenant-keyed values of rows without an owner move under their record key, tenant-keyed values of rows with an owner still move under that owner. The pass rewrites event payloads in place through the existing backfill path and queues the affected projections for rebuild. Apps that run the backfill manually call `backfillEventPiiEncryption` with `resolveOwnerFromProjection: true, rekeyTenantKeyedOwnerFields: true`, then rebuild the projections. Values of a record forgotten earlier become `[[erased]]`. The re-key covers entity lifecycle events only: custom `defineEvent` piiFields that switch from `whenAbsent: "tenant"` to `"self"` keep their old events tenant-keyed.

  Old events are never reinterpreted at read time: an old created event of a row that got an owner later keeps its record key until a forget of that record, which erases it, while the later owner-keyed copies stay readable.
-->

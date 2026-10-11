---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Entity PII fields get personal.whenAbsent: "tenant"; a nullable owner field without it fails boot

<!-- kumiko-changes
feature: framework
type: breaking
title: Entity PII fields need whenAbsent: "tenant" when the owner field is nullable
detail: |
  personal: { of: "<owner>", whenAbsent: "tenant" } makes rows without an owner editable, deletable and forgettable with an active KMS, without plaintext PII. The subject is resolved in this order: the owner on the previous row, the owner the same event sets, then the tenant key (tenant:<tenantId>). Before, an update, delete or forget of an ownerless row failed with SubjectResolutionError (HTTP 500) once a KMS was configured. backfill-pii follows the same chain and checks the projection row for the owner before it falls back to the tenant key; an updated event whose previous.owner is null but whose changes.owner is set no longer loses the owner. Entity fields have no plaintext fallback, so "tenant" is the only value. bundled jobs: cron and system runs (triggeredById null) now store payload, error and log messages as ciphertext under the system tenant key instead of plaintext.
migration: |
  Boot now aborts for a personal: { of: "<owner>" } field whose owner field is not required and that declares no whenAbsent: [Feature X] Field "f" on entity "e" is personal: { of: "ownerId" }, but "ownerId" is not required — rows without an owner would fail to encrypt (SubjectResolutionError, HTTP 500) on update, delete and forget. Declare { personal: { of: "ownerId", whenAbsent: "tenant" } } to encrypt those rows under the tenant key, or make "ownerId" required: true. Entity fields have no plaintext fallback (fw#3654). Fix: add whenAbsent: "tenant", or make the owner field required: true if every row has one. whenAbsent on personal: { of: "id" } throws at declaration. Known consumer sites: kumiko-enterprise kumiko-credit entity.ts and bauspar-entity.ts (ownerUserId), ai-agent entity.ts (authorId, ownerId) and attachment-store.ts (authorId), ai-conversation entity.ts (authorId), pattern-storage entity.ts (authorId), offlot-app src/features/lead/schema/entity.ts (enquiryId). Existing plaintext job-run rows of cron runs stay readable; new ones are ciphertext.
-->

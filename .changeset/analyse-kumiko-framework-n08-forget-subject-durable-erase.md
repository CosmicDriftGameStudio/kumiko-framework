---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`crypto-shredding:write:forget-subject` runs in one transaction and has the subject key erased after commit; entities can opt into being forgotten with their subject.

<!-- kumiko-changes
feature: crypto-shredding
type: breaking
title: forget-subject erases the key after commit and forgets forgetWithSubject rows
detail: forget-subject no longer calls kms.eraseKey itself. It closes a user's login, purges search documents and files, forgets the rows of entities that declare the new `forgetWithSubject: true` (the record subject's own row, or the row whose id is the forgotten user id when the entity has a `personal: "self"` field), erases note bodies, nulls blind indexes and appends `subject-forgotten`, all in the handler transaction. The new `crypto-shredding:projection:subject-key-eraser` consumer erases the key once that transaction commits. A failure now rolls the whole forget back instead of erasing the key and writing an audit event with `cleanupError`; the `cleanupError` field is gone from the payload. `subject-forgotten` always lands on a fresh aggregate id, never the subject's id. user-data-rights forget-cleanup and forget-subject share `eraseSubjectData`; the cleanup now nulls blind indexes even without a KMS. Boot rejects `forgetWithSubject` on an entity without a `personal: "self"` or record-keyed field, or with `retention.strategy: "blockDelete"`.
migration: Code that reads the key state right after forget-subject waits for the consumer; tests call `drainEventConsumers(stack, ["crypto-shredding:projection:subject-key-eraser"])`. Consumers of `subject-forgotten` read the subject from `payload.subjectKey` instead of `aggregateId`. App-built cascades that forget a subject's own row after forget-subject (publicstatus forgotten-subscriber-cascade, offlot dealer-link forget, money-horse erase-recipient) are replaced by `forgetWithSubject: true` on the entity plus a dispatch of forget-subject inside the handler transaction.
-->

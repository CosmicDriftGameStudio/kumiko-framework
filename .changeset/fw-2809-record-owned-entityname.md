---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

fw#2809: **BREAKING** — `encryptPiiFieldValues` and `resolveSubjectForField` now require `entityName` on their options argument (`EncryptPiiOptions.entityName` / `ResolveSubjectOptions.entityName`), and `encryptForDirectWrite` takes a new `entityName` parameter.

Before this change, `entityName` was optional and silently omittable everywhere except the event-store executor, which always supplied it. A `recordOwned` field written through any other path (unmanaged direct-write stores, the billing/inbound-mail programmatic write-handlers) could resolve its subject with no entity name and fail loud only at write time, deep inside `resolveSubjectForField`. Making the option required turns that into a compile-time signal at every call site.

A new boot guard (`validateRecordOwnedSubjects`) closes a related gap: a `recordOwned` field on an entity with `idType: "serial"` now fails boot instead of shipping a field that's encrypted under `record:<entity>:<id>` but can never be shredded — `forgetSubject`'s `subjectIdSchema` validates that id as a UUID, so a serial primary key could never satisfy a forget-subject request.

Migration — every direct `encryptPiiFieldValues(...)` / `resolveSubjectForField(...)` call and every `encryptForDirectWrite(...)` call needs the entity's registry name (the same name passed to `r.entity(name, ...)` / used as `aggregate_type`):

```ts
await encryptPiiFieldValues(row, entity, piiFields, kms, kmsCtx, { entityName: "mail-account" });
await encryptForDirectWrite(userSessionEntity, "user-session", row, "sessions:create");
```

The runtime fallback in `resolveSubjectForField` (throwing `SubjectResolutionError` on an empty `entityName`) stays in place as defense-in-depth, matching the #2558 pattern.

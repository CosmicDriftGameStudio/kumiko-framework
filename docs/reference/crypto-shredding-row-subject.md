---
status: reference
verified: 2026-09-11
---

# Crypto-shredding: the "record" (row) subject

`personal`/`find` annotations bind a PII field to the subject whose
encryption key it shreds under. Most fields belong to a user or a tenant —
but some rows carry PII with no user reference at all: a free-text support
note, a contact-form submission, an anonymous survey answer. For those, the
**row itself** is the subject.

## When to use it

Use the record subject when a field is personal data but there is no
`ownerField` to point at — annotating it `personal: "self"` would be wrong
(that means "this row is a user"), and leaving it plaintext skips Art. 17
erasure entirely. Use `personal: { of: "<field>" }` with a real reference
field whenever a user reference DOES exist; the record subject is for the
remaining case where none does.

## The three subject kinds

| kind | declared via | key format | erase trigger |
|---|---|---|---|
| user | `personal: "self"` / `personal: { of: "<field>" }` | `user:<uuid>` | user-forget |
| tenant | `personal: "tenant"` | `tenant:<uuid>` | tenant-destroy |
| record | `personal: { of: "id" }` | `record:<entity>:<id>` | record-forget |

All three share one ciphertext format
(`kumiko-pii:v2:<subjectKey>:<base64>`) — `record` only adds a new
`subjectKey` namespace, not a new cipher. `record:<entity>:<id>` and
`user:<id>` never collide even when `<id>` is the same uuid: the key is
parsed back on exactly one `:`, so an entity name may not contain one
(`subjectKeyForRecord` throws if it does).

## Declaration

Author-facing, `personal: { of: "id" }` looks identical to any other
owner-reference annotation — `"id"` just happens to be the row's own
primary key instead of a foreign reference. It resolves internally to
`recordOwned: true` (not `userOwned: { ownerField: "id" }`), so downstream
GDPR guards never mistake a record subject for user-forget coverage and
never build an `id = <userId>` search-purge predicate for it.

## Entity name is mandatory at the write path

Resolving a `recordOwned` field needs the row's canonical registry entity
name (`ResolveSubjectOptions.entityName` — the executor's `options.entityName`,
which is also the event's `aggregate_type`). Every write path that encrypts
PII (`encryptPiiFieldValues`, the event-store executor, the PII backfill)
threads this through. Missing it is fail-closed: `resolveSubjectForField`
throws `SubjectResolutionError` rather than falling back to plaintext or a
wrong subject.

## `forget-subject` payload

```json
{ "subject": { "kind": "record", "entity": "recordProbe", "id": "<uuid>" }, "reason": "..." }
```

`entity` must be an identifier-shaped registry entity name (no `:`); `id`
must be a uuid. The handler resolves `entity` against the mounted feature
registry — never straight into SQL — and denies (not 500s) an unregistered
name.

## Tenant gate

A DataProtectionOfficer is tenant-scoped: a record forget is denied unless
the target row's own `tenant_id` matches the actor's tenant
(`recordRowExistsInTenant`), mirroring the existing user/tenant checks.
SystemAdmin bypasses it. Without a mounted `tenant` feature there is no
tenant concept to enforce, so the gate fails open — same rule as the
user-subject branch.

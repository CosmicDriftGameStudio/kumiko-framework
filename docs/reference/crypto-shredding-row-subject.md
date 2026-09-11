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

## Backfilling pre-declaration plaintext (fw#2790)

Declaring a field `personal: { of: "id" }` protects writes **from that point
on**. Any event appended before the declaration still carries the field as
plaintext in `kumiko_events` — the executor appends a row exactly as it
looked at write time (`event-store-executor-write.ts`), and crypto-shredding
has no forward-acting effect on history.

Two ways to close that gap were on the table: a backfill job that
re-encrypts the historical payloads in place, or a documented, permanent
boundary (only stream deletion erases the backlog). The framework already
answers this — `backfillEventPiiEncryption`
(`packages/framework/src/db/queries/backfill-pii.ts`, fw#799) re-encrypts
pre-KMS/pre-declaration plaintext PII in `kumiko_events` in place, per
field, under the owning subject's key, and it is a **generic** pass over
every field with a subject annotation (`collectPiiSubjectFields` /
`resolveSubjectForField`) — it does not special-case which of the three
subject kinds a field carries. Adding the `record` kind in fw#2786 needed
no change to this backfill: it already covers a freshly-declared row-subject
field on any entity that uses the normal event-store-executor lifecycle
(`<entity>.created` / `.updated` / `.deleted` / `.forgotten` / `.restored`).
See `packages/framework/src/event-store/__tests__/backfill-pii.integration.test.ts`,
describe block `"backfillEventPiiEncryption: record subject (kumiko-framework#2786)"`,
for the regression coverage that pins this down (encrypts under
`record:<entity>:<id>`, handles updates, erases a pre-KMS-forgotten row
instead of minting a fresh key, is idempotent).

This is not "rewriting history" in the sense the append-only log guards
against: the backfill changes a field's *representation*
(plaintext → key-gated ciphertext), never what the event *asserts* happened.
Replay stays deterministic — `applyEntityEvent` materializes the same
ciphertext plus its blind-index column, which is why a backfill run must be
followed by a projection rebuild. The framework already has a more invasive
precedent for in-place event mutation (fw#762, `stream-tenant-backfill.ts`,
renumbers `version` and rewrites `tenant_id` to merge split streams) —
representation-only re-encryption is the milder case of the same category.
Refusing it in the name of append-only purity would leave stream deletion as
the only Art. 17 remedy for the backlog, which destroys far more of the log
than re-encrypting one field.

**Operator action:** after declaring a field `record`-owned (or any subject
kind) on a field that pre-existed, run `backfillEventPiiEncryption(db,
registry)` once against the estate — `dryRun: true` first to see the
projected counts — then rebuild the affected projections.

**Known residual gap:** `backfillEventPiiEncryption` only walks two event
shapes: registry-entity lifecycle events (covered above) and the custom
event catalog (`r.defineEvent(..., { piiFields })`). The catalog path
hardcodes `{ kind: "user", userId }` for every catalogued field — it cannot
target a `tenant` or `record` subject. A free-text field carried in a custom
domain event (not a registry entity) under a tenant/record subject is
**not** backfillable today; that field is a documented, permanent
boundary (Weg 2) until the catalog path is generalized. Tracked as a
follow-up: fw#2801.

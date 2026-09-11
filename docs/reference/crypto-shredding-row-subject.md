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

## Retention gate

The host entity's own `retention.strategy` (as declared via `createEntity({
retention })`) is consulted before a record forget shreds anything: a
`blockDelete` entity — legally mandated physical retention, e.g. ledger or
invoice text (Art. 17(3)(b)) — **refuses** the request instead of silently
anonymizing or proceeding. This runs after the tenant gate (a retention
check ahead of it would leak a foreign entity's retention posture to a
cross-tenant prober) but always before any key is touched, and independently
of whether a `tenant` feature is mounted — a retention obligation holds in
single-tenant apps too.

Only the entity's own declaration is consulted here, **not** the
`data-retention` feature's tenant-preset/override layering
(`resolveRetentionPolicy`/`policy-for`). A tenant cannot override its way
past a `blockDelete` declared on the entity through this command. This is
different from the automated Art.-17 cleanup pipeline
(`user-data-rights/run-forget-cleanup.ts`'s `policyToStrategy`), which maps
`blockDelete` to `anonymize` and proceeds — that pipeline runs the retention
strategy's own remediation; this operator command only ever deletes the row
subject's key outright, so for a `blockDelete` entity it must decline rather
than pick a strategy on the operator's behalf.

This check runs after the tenant gate's `isSystemAdminActor` early-return, so
it applies to SystemAdmin too — a retention obligation is not a permission
that a higher role can waive, so `blockDelete` refuses the request
regardless of actor role.

## Operator runbook: an Art. 17 request the mentions never found

A row's structured-mention forget hook (#2787, still open) will eventually
reach rows that name a subject through an explicit @-mention. Prose that
names a third party without one ("Meeting mit Sabine M.") is real PII but
invisible to that trigger — the row is still erasable (row-subject
encryption makes that true unconditionally once the entity declares
`personal: { of: "id" }` on the field), it's just never found automatically.
This is the manual path for those requests.

As of this writing `personal: { of: "id" }` is not yet declared on any
production entity — only on test probes (see
`packages/bundled-features/src/crypto-shredding/__tests__/`) — and #2788
tracks making it the default. Nothing below fires until some entity actually
opts a field in; the steps document the mechanism, not a currently-live
production path.

1. **Find the candidate rows.** There is no mention index for prose without
   a mention — the request itself has to name the row. Typical sources: the
   requester's own export/complaint quoting the text, a support ticket that
   references the note, or a tenant operator's full-text search over the
   entity's list screen for the subject's name. Confirm the entity's
   registry name and the row id for each candidate, and confirm the field
   in question is actually declared `personal: { of: "id" }` — if it isn't,
   this command has nothing to shred and the plaintext is still in the
   projection.
2. **Check the host entity's retention strategy first.** If it declares
   `retention.strategy: "blockDelete"` (see above), stop — this command will
   refuse it. `blockDelete` means the row is under a legal retention
   obligation; the remedy is that entity's normal retention/anonymize path
   (the same one the automated Art.-17 cleanup uses), not a forced row
   erase. Escalate to whoever owns that entity's retention policy instead
   of retrying.
3. **Otherwise, dispatch the forget.** As DataProtectionOfficer or
   SystemAdmin, call `crypto-shredding:write:forget-subject` with
   `{ subject: { kind: "record", entity, id }, reason }` per row. `reason`
   is free text (min. 10 chars) and becomes part of the permanent audit
   trail — name the request it answers, not just "GDPR". The actor
   (`forgottenBy`) is taken from the authenticated session
   (`event.user.id`), never from the request payload
   (`forgetSubjectSchema` only accepts `{ subject, reason }`) — the audit
   event cannot be forged to attribute the erase to someone else.
4. **Verify.** Re-read the row's projection: the shredded field now renders
   the `[[erased]]` sentinel. The raw event-store ciphertext for that
   aggregate is unreadable forever, but was written before the shred and
   stays in `kumiko_events` in that (now-erased) form — there is no
   retroactive rewrite of the event log (tracked separately: #2790 covers
   entities whose plaintext PII predates a row-subject declaration
   entirely, which is a different gap).
5. **Keep the paper trail.** The `subject-forgotten` (or, if refused,
   `forget-denied`) audit event is the system's proof; log the external
   request (ticket/authority reference) against the same `subjectKey`
   outside the system per your own Art. 17 record-keeping duty.

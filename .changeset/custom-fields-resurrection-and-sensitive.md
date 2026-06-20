---
"@cosmicdrift/kumiko-bundled-features": patch
---

custom-fields: fix two event-sourcing correctness gaps.

1. **Resurrection** — `define → delete → re-define` of the same `(entity, fieldKey)` failed with `version_conflict` (409) permanently: the deterministic aggregate-id left a `created+deleted` stream and the next `create()` collided at version 0, so a deleted custom field could never be re-defined (and its delete-cascade had already wiped the values). `fieldDefinition` is now `softDelete`, and the define handlers resurrect via `restore()` + `update()` (overwriting with the new definition). Quota counts only active definitions.

2. **PII in the event log** — a custom field marked `sensitive: true` had its value written into the `customField.set` event (via `unsafeAppendEvent`), so a user-forget that strips the projection still left the value in `kumiko_events` (an Art. 17 gap, also undone by a projection rebuild). Sensitive values are now **self-projected** into the host row directly by the write handler — exactly like the entity executor handles `sensitive` entity fields — and the persisted event omits the value. PII never enters the immutable log; the existing forget-strip erases it durably. A projection rebuild loses the value, which is intentional (identical to a `sensitive` entity field).

Also: `update-tenant-field` now rejects flipping a field's `sensitive` flag (immutable, like `type`) — a non-sensitive→sensitive switch can't retroactively erase already-logged values, so changing sensitivity requires delete + re-define.

Note: change 1 adds an `is_deleted` column to `read_custom_field_definitions` (entity is now soft-delete) — additive migration required on existing deployments (`kumiko schema` generates the `ALTER TABLE ADD COLUMN`); the quota query and executor depend on it.

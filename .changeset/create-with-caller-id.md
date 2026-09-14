---
"@cosmicdrift/kumiko-framework": minor
---

Entity create handlers accept an optional, UUID-validated `id` in the payload, honored only for a system-identity caller (`createSystemUser(tenantId, extraRoles)`) — an event-triggered job or hook can now derive a deterministic id (new `generateDeterministicId(namespace, key)` in `utils`) and create idempotently instead of matching on description text. An HTTP-authenticated end user's `id` is silently ignored, exactly as before this field existed.

---
"@cosmicdrift/kumiko-bundled-features": minor
---

tier-engine: add a SystemAdmin-only manual tier grant so an operator can
assign any tenant a pricing tier **without a billing purchase** — the missing
piece for testing and operating `>Free` features before Stripe is wired.

- `tier-engine:write:set-tenant-tier` — cross-tenant upsert keyed on the
  deterministic per-tenant aggregate-id. Writes through a `"system"`-mode
  `TenantDb` on the **target** tenant so the event lands in the target's
  stream (the `set.write` override-user pattern only reaches
  `SYSTEM_TENANT_ID`). Stamps `source: "manual"` so a future Stripe→tier sync
  won't overwrite the grant.
- `tier-engine:query:get-tenant-tier` — cross-tenant read of any tenant's
  assignment (SystemAdmin-only).
- `tier-engine:query:tier-options` — exposes the configured `TierMap`'s tier
  names to the client (the map is a server-side closure).
- `tier-assignment` entity gains an optional `source` field
  (`"manual" | "stripe" | "default"`); the auto-default-on-signup hook now
  stamps `"default"`. Additive + nullable — back-compat with existing rows.
- New `tier-admin` custom screen (`r.screen`, SystemAdmin-only) plus a
  `tierEngineClient()` client feature exported from
  `@cosmicdrift/kumiko-bundled-features/tier-engine/web`. Apps surface it with
  a single `r.nav({ screen: "tier-engine:screen:tier-admin" })`.

Writes stay SystemAdmin-only (a TenantAdmin setting their own tier would be a
free self-upgrade); an integration test pins the cross-tenant boundary,
fail-closed denial for non-SystemAdmins, `source: "manual"`, and idempotent
upsert.

# Tier Admin

Manually assign a pricing tier to a tenant — without a billing purchase
and without writing the projection by hand. The recipe shows the
SystemAdmin-only operator flow plus the subtlety that makes it correct:
the grant updates the in-memory resolver cache synchronously, so
toggleable features unlock in the same request.

## What it shows

- **`tier-engine:write:set-tenant-tier`** — a SystemAdmin assigns a tier
  to *any* tenant, cross-tenant. Stamps `source: "manual"` so a future
  Stripe → tier sync won't overwrite the grant.
- **`tier-engine:query:get-tenant-tier`** — SystemAdmin reads back which
  tier a tenant is on plus its source (`"manual"` vs `"billing"`).
- **`tier-engine:query:tier-options`** — lists the configured tier names
  so the admin UI doesn't have to hard-code them.
- **`notes-export`** — a `r.toggleable()` feature the `pro` tier unlocks.
  It appears in a tenant's effective-features set only when its tier lists
  it (`pro` does, `free` does not).
- **Cache-sync invariant** — the manual grant updates the resolver cache
  the same request, not just the projection. `notes-export` is in the
  tenant's effective set immediately after the set call — same request,
  before any cache refresh, replay, or restart.

## Feature composition

```
config       → tenant config (tier-engine dependency)
tenant       → tenant records for cross-tenant grants
tier-engine  → set-tenant-tier, get-tenant-tier, tier-options
notes-export → r.toggleable() domain feature unlocked by pro tier
```

## Flow

1. SystemAdmin calls `set-tenant-tier` for a **foreign** tenant with
   `tier: "pro"` → event lands in the target tenant's stream,
   `source: "manual"`.
2. `get-tenant-tier` read-back confirms tier + source (billing sync must
   not overwrite manual grants).
3. `tier-options` returns keys from your static `TierMap` — no hard-coded
   tier list in the UI.
4. Resolver built **before** the grant now reports `notes-export` in the
   tenant's effective set — same process, no rebuild (cache-sync proof).

## Why the cache invariant matters

`set-tenant-tier` writes through the event-store executor directly. That
path bypasses the `postSave` entity-hook the resolver normally uses to
invalidate the cache after a tier-assignment change. Without an explicit
cache update the grant would persist (next request would see it) but
*this* request still sees the old tier — surprising for an operator who
just clicked "set tier to pro".

The feature wires `onAssigned` into `createSetTenantTierWrite` for
exactly this reason.

## Tests

```bash
bun test src/__tests__/feature.integration.test.ts
```

Integration test proves:

- Cross-tenant grant + read-back with `source: "manual"`
- `tier-options` matches `TierMap` keys
- Idempotent re-grant updates the same aggregate
- TenantAdmin without SystemAdmin → 403
- Resolver sees `notes-export` immediately after grant (cache-sync)

## Related samples

- [apps-cap-billing-demo](/en/samples/apps-cap-billing-demo/) — tier from
  billing webhooks + cap enforcement.
- [recipes-encrypted-tenant-config](/en/samples/recipes-encrypted-tenant-config/) —
  per-tenant config keys gated by tier.

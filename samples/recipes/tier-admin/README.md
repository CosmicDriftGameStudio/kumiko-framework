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
- **Cache-sync invariant** — the manual grant updates the resolver cache
  the same request, not just the projection. A `r.toggleable()` feature
  that depends on the granted tier is reachable immediately after the
  set call, before any cache refresh, replay, or restart.

## Why the cache invariant matters

`set-tenant-tier` writes through the event-store executor directly. That
path bypasses the `postSave` entity-hook the resolver normally uses to
invalidate the cache after a tier-assignment change. Without an explicit
cache update the grant would persist (next request would see it) but
*this* request still sees the old tier — surprising for an operator who
just clicked "set tier to pro".

The feature wires `onAssigned` into `createSetTenantTierWrite` for
exactly this reason; the integration test below exercises the full flow
end-to-end so the invariant has runnable evidence.

## Run

```bash
bun test src/__tests__/feature.integration.test.ts
```

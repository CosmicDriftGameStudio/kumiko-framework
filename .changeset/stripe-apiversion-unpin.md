---
"@cosmicdrift/kumiko-bundled-features": patch
---

subscription-stripe: stop pinning a hardcoded Stripe `apiVersion` (#256)

The Stripe client was constructed with a string-literal `apiVersion`
(`"2026-04-22.dahlia"`). Because bundled-features ship as TS sources, every
consumer typechecks this file against its own resolved `stripe` SDK — and a
consumer on a newer SDK (e.g. `^22.2.0`) fails with
`TS2322: "2026-04-22.dahlia" is not assignable to "<newer>"`, since the literal
no longer matches the SDK's `Stripe.LatestApiVersion`.

The client is now constructed without an `apiVersion`. The SDK falls back to its
own `DEFAULT_API_VERSION` — the exact version its types are generated against —
so the wire API version and the TS types always move together when the consumer
bumps `stripe`. This is behaviorally identical for stripe `22.1.1` (whose default
*is* `2026-04-22.dahlia`) and removes the latent typecheck break for newer SDKs.

Consumers that worked around this with `overrides.stripe = "22.1.1"` can drop
that pin once they upgrade.

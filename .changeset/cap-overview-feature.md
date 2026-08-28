---
"@cosmicdrift/kumiko-bundled-features": minor
---

Add `cap-overview` — read-only tier/cap-usage visibility. SystemAdmin gets a platform-wide list of every tenant with tier, billing status, and usage bars against a configurable set of caps; TenantAdmin gets their own usage as dashboard cards, and SystemAdmin can click through from the list into a tenant's own dashboard. Reads tier-engine's tier assignments, billing-foundation's subscriptions, and tenant data, plus app-owned usage tables via caller-supplied `CapSpec` callbacks — never writes.

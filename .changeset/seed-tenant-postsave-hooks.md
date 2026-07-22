---
"@cosmicdrift/kumiko-bundled-features": minor
---

tenant: seedTenant fires entity postSave hooks (#1463). `seedTenant` writes through the raw event-store executor, which never fired postSave hooks — self-signup (`provisionSignupAccount` → `signup-confirm`) silently skipped feature-registered entity hooks like tier-engine's auto-default-tier and app-level auto-default-compliance, leaving new tenants without a tier/compliance row. `seedTenant` and `provisionSignupAccount` take a new optional `hooks: { registry, context }` param; passing it fires the same entity-scoped postSave hooks the dispatcher would, without the full dispatch roundtrip. Existing call-sites are unaffected — the param is optional and append-only.

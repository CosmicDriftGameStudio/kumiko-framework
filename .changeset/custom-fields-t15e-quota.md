---
"@cosmicdrift/kumiko-bundled-features": minor
---

custom-fields: per-tenant fieldDefinition quota (T1.5e).

`createCustomFieldsFeature({ fieldDefinitionLimitPerTenant: N })` installs a quota-aware `define-tenant-field` handler. The handler runs a `COUNT(*)` on `read_custom_field_definitions` per tenant before insert and rejects with `unprocessable` + `reason: cap_exceeded` once the limit is reached.

Cap is per-tenant total (across all entity-names), not per entity-name — the natural unit for tier-pricing.

Without the option, behavior is unchanged: the singleton feature and its handler retain pre-T1.5e semantics.

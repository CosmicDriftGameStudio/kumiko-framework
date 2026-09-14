---
"@cosmicdrift/kumiko-framework": minor
---

A `money` field can now declare `currency: { kind: "tenant" }` (`MoneyCurrencySource`, exported from `@cosmicdrift/kumiko-framework/engine/types`) so its currency comes from the tenant-settings config key (`tenant-settings:config:currency`) instead of `entity.defaultCurrency ?? "EUR"`. An entityEdit form (create and update) reads the tenant currency via the existing `config:query:values` query for those fields, seeds an empty value with it, and waits for the query rather than momentarily defaulting to EUR. A stored value always keeps its own currency; a field without the declaration is unchanged.

---
"@cosmicdrift/kumiko-framework": patch
---

An optional `select` field without a `default` now accepts `""` as "unset" (stored as `null`) instead of rejecting it as an invalid enum value. Previously, an untouched HTML `<select>` submitted `""` for its placeholder option, which `buildInsertSchema`/`buildUpdateSchema` validated against the field's enum and rejected — blocking save on any form with an optional select the user never touched (#1674). The value maps to `null` rather than being dropped, so an update can also clear a previously-set select back to unset.

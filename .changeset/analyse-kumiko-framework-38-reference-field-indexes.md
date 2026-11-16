---
"@cosmicdrift/kumiko-framework": patch
---

Every single-value reference field of an entity gets its own index, so lookups by the referenced row no longer scan all rows of the tenant.

<!-- kumiko-changes
feature: framework
type: improvement
title: Reference fields are indexed automatically
detail: Entity tables indexed foreign keys only for file and image fields and for `belongsTo` relations declared with `r.relation()`. A plain `type: "reference"` field such as `propertyId` had no index unless the entity declared one, so every filter by it scanned the tenant's rows. `buildEntityTable` and `deriveEntityTableMeta` now add `<table>_<column>_idx` for each reference field without `multiple: true`. A field that already leads a declared index in `indexes` is skipped, because that index covers the lookup.
migration: Run `bun kumiko-schema generate <name>` after the bump and ship the migration. Until then the new indexes are missing; boot is not affected.
-->

---
"@cosmicdrift/kumiko-bundled-features": minor
---

store_delivery_attempts gets an index on (tenant_id, created_at) (fw#3396)

Windowed per-tenant dashboard aggregates over delivery attempts (metrics feature) filter on tenant_id and created_at.

<!-- kumiko-changes
feature: delivery
type: improvement
title: store_delivery_attempts gets an index on (tenant_id, created_at) (fw#3396)
migration: |
  Run `kumiko migrate generate` and apply the migration: it adds `store_delivery_attempts_tenant_id_created_at_idx`.
-->

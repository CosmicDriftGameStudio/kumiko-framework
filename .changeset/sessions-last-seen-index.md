---
"@cosmicdrift/kumiko-bundled-features": minor
---

store_user_sessions gets an index on (tenant_id, last_seen_at) (fw#3396)

Active-user dashboard aggregates (metrics feature) filter on tenant_id and last_seen_at.

<!-- kumiko-changes
feature: sessions
type: improvement
title: store_user_sessions gets an index on (tenant_id, last_seen_at) (fw#3396)
migration: |
  Run `kumiko migrate generate` and apply the migration: it adds an index on `store_user_sessions (tenant_id, last_seen_at)`.
-->

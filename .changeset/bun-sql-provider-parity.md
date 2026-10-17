---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Bun.SQL provider parity

<!-- kumiko-changes
feature: framework
type: fix
title: Bun.SQL provider parity fixes for DB_PROVIDER=bun
detail: Array params bind as Postgres array literals, transaction handles are detected correctly, Instant params are stored at millisecond precision, integer params reject fractions, and migrations hold their advisory lock on one pinned connection.
-->

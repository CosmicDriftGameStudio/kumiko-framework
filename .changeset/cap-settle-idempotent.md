---
"@cosmicdrift/kumiko-bundled-features": patch
---

cap-counter calendar settle is idempotent

<!-- kumiko-changes
feature: cap-counter
type: fix
title: cap-counter calendar settle is idempotent
detail: Settling a calendar cap reservation now keeps the row as a tombstone (new column store_cap_reservations.settled_at, retained for 24 hours) instead of deleting it. A repeated settle with the same reservation id is a no-op, and confirm, give-back and expiry sweep ignore settled rows. The sweep deletes expired tombstones.
migration: Apps with cap-counter generate a migration for the new column store_cap_reservations.settled_at (kumiko migrate generate).
-->

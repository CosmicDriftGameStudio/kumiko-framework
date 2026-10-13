---
"@cosmicdrift/kumiko-bundled-features": patch
---

cap-counter now exports its reservation table, so consumers and their tests can read open reservations without declaring `store_cap_reservations` themselves.

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: cap-counter exports capReservationsTable and capReservationsTableMeta
detail: The reservation table store_cap_reservations was only reachable through internal imports, so kumiko-enterprise redeclared it in a test. The cap-counter entry now exports capReservationsTable and capReservationsTableMeta, following the feature-toggles pattern.
-->

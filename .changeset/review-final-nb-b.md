---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Boot seeds (admin, shortcut seeds, config and notification-template seeds) are retried with the database backoff when they fail with a transient connection error. Before, a database that dropped out briefly during seeding aborted the whole boot and sent the pod into a restart loop. The retry shares the 1 to 15 second backoff and 90 second deadline of the database wait; validation errors and every other failure stay fatal immediately.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Boot seeds survive a short database outage
detail: applyStandardBootSeeds re-runs the idempotent seed sequence with the database backoff on transient connection errors (ECONNREFUSED, connection class 08, too_many_connections) until the 90 second deadline. Non-transient errors still abort the boot at once.
-->

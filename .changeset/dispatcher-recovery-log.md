---
"@cosmicdrift/kumiko-framework": patch
---

event-dispatcher logs when the DB comes back after an outage (fw#3243)

<!-- kumiko-changes
feature: framework
type: fix
title: event-dispatcher logs when the DB comes back after an outage (fw#3243)
detail: |
  A DB outage already kept the dispatcher process alive (the postgres pool
  reconnects per query and the dispatcher keeps polling from its cursor) and
  logged `idle pre-check failed` once per outage, but recovery was silent:
  ops had no signal that delivery was back to normal without restarting the
  process. The idle pre-check now logs `idle pre-check recovered, database
  reachable again` once the next pass succeeds after a logged failure, no
  restart needed.
-->

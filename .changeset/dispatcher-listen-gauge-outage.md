---
"@cosmicdrift/kumiko-framework": patch
---

LISTEN gauge drops to 0 on a DB outage

<!-- kumiko-changes
feature: framework
type: fix
title: LISTEN gauge drops to 0 on a DB outage
detail: |
  `kumiko_event_dispatcher_listen_connected` stayed at 1 when the LISTEN
  connection died during a DB outage, although delivery had already fallen
  back to polling. The dispatcher now sets it to 0 when the idle pre-check
  detects the outage. postgres.js re-LISTENs on its own once the DB is back
  (delayed by its connect backoff, measured 10-30s) and sets it back to 1.
-->

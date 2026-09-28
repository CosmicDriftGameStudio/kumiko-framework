---
"@cosmicdrift/kumiko-server-runtime": minor
---

runProdApp wires auth-email-password's new invite-info query into invite.infoHandler

When the invite feature is enabled, runProdApp now passes AuthQueries.inviteInfo as invite.infoHandler, mounting POST /auth/invite-info automatically.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runProdApp wires auth-email-password's new invite-info query into invite.infoHandler
migration: |
  No action needed: purely additive wiring, no option changes.
-->

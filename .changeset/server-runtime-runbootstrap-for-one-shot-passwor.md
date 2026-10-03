---
"@cosmicdrift/kumiko-server-runtime": minor
---

runBootstrap() for one-shot passwordless prod provisioning; runProdApp auth.admin is optional

Creates tenants (seed hook only on creation) and mails invitations; reruns send nothing, expired unused invitations are re-sent. Convention bin/bootstrap.ts -> dist-server/bootstrap.js.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runBootstrap() for one-shot passwordless prod provisioning; runProdApp auth.admin is optional
-->

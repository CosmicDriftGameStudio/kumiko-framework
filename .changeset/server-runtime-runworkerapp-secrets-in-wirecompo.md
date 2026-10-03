---
"@cosmicdrift/kumiko-server-runtime": minor
---

runWorkerApp: secrets in wireComponents and a metrics port

WorkerWireDeps carries ctx.secrets (for createInboundMailSupervisor), and the new metrics option serves /metrics on its own port; KUMIKO_DRY_RUN_ENV=boot validates it.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runWorkerApp: secrets in wireComponents and a metrics port
-->

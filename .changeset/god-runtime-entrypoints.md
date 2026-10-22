---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-testing": patch
---

`runProdApp()`, `runDevApp()` and `setupTestStack()` are now short composers that call one named phase function per boot step. Step order, log and error texts, wait paths and shutdown order are unchanged.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runProdApp split into boot phases, boot steps shared with dev and worker
detail: runProdApp() keeps its signature and behavior. Config resolution, feature composition, dependency connection, request context, auth wiring, entrypoint, seeds and the returned handle now live in run-prod-app-*.ts files next to run-prod-app.ts. Steps that prod, dev and the worker ran as copies (env defaults, feature composition, boot validation, the auth-mfa switch-tenant gate, the tier and feature-toggle resolver, standard boot seeds, shared auth routes, the KMS health gate and the database pools) live once in the new subpath @cosmicdrift/kumiko-server-runtime/boot/shared-boot-steps. requireEnv is still exported from run-prod-app under the same name.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: runDevApp split into boot phases
detail: runDevApp() keeps its signature and behavior. Config resolution and boot validation (run-dev-app-config.ts), late-bound tier, session and token wiring plus the onAfterSetup step (run-dev-app-auth.ts) and the createKumikoServer options (run-dev-app-server-options.ts) are separate phases. Steps shared with prod come from @cosmicdrift/kumiko-server-runtime/boot/shared-boot-steps. A new unit test covers the late-bound tier resolver's boot-order guard and trialGate delegation.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: setupTestStack split into setup phases
detail: setupTestStack() keeps its signature and behavior. Feature validation, storage provisioning with its DDL cleanup, cache sync, services, the job runner and the server start are separate phases in stack/test-stack-setup.ts. The cleanup on a failed setup still stops the job runner, closes cache sync and drops the test database and Redis in that order.
-->

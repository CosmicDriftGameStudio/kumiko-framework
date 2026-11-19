---
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-testing": minor
---

`kumiko ports` also scans apps under `<repo>/apps/*`, and the scaffolded Playwright config reads its port from kumiko.config.ts.

<!-- kumiko-changes
feature: guards
type: fix
title: Port registry sees nested apps
detail: The workspace port scan now also reads `<child>/apps/*/kumiko.config.ts` when the child itself has no config, so a monorepo app such as `timeline-murder/apps/server` takes part in the collision check.
-->

<!-- kumiko-changes
feature: testing
type: breaking
title: Scaffolded Playwright config uses ports.e2e
detail: The generated `playwright.config.ts` imports the app's kumiko.config.ts and passes `appConfig.ports.e2e`, so the e2e port is declared once. `renderTestSetup` no longer takes `port`, and `SCAFFOLD_E2E_PORT` is no longer exported.
migration: Existing apps write `import appConfig from "./kumiko.config";` and `defineAppE2eConfig({ port: appConfig.ports.e2e })` in playwright.config.ts. Callers of `renderTestSetup` drop the `port` argument.
affects: renderTestSetup, SCAFFOLD_E2E_PORT, defineAppE2eConfig
-->

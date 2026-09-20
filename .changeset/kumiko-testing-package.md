---
"@cosmicdrift/kumiko-testing": minor
---

New package: test template for Kumiko apps

seedTenant gives each test its own tenant (light by default, persist: true writes real rows through the dispatcher), setupAppTestStack mounts the bundled features and the entity projection tables, the preload subpaths (temporal, ci-log, scrub-env, env, real) replace the per-repo test-setup copies and scrub provider API keys, renderBunfig generates the bunfig variants, and kumiko-testing integration runs the integration files with the 15s budget and opt-in parallelism.

<!-- kumiko-changes
feature: testing
type: improvement
title: New kumiko-testing package with seedTenant, preloads, bunfig generator and integration runner
-->

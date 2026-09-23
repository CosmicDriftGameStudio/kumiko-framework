---
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-testing": patch
---

E2E webserver builds Tailwind CSS once instead of running a `--watch` process

`defineAppE2eConfig` sets `KUMIKO_DEV_STYLESHEET_WATCH=0`, so the dev-server it boots builds CSS once and stops instead of keeping a Tailwind `--watch` process alive. Tailwind v4's watcher subscribes to the whole app cwd recursively with no gitignore filter, so every Playwright artifact write under `test-results/` previously counted as a rebuild trigger.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: createKumikoServer/runDevApp gain stylesheetWatch (env KUMIKO_DEV_STYLESHEET_WATCH=0) to build Tailwind CSS once without a --watch process
-->

<!-- kumiko-changes
feature: testing
type: fix
title: defineAppE2eConfig starts the E2E web server without a Tailwind --watch process, so Playwright artifact writes no longer trigger hundreds of CSS rebuilds
-->

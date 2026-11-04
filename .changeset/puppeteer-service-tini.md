---
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

The puppeteer service image runs under tini.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: fix
title: puppeteer-service image reaps Chromium child processes
detail: The service ran bun as PID 1, which does not reap orphaned processes, so every idle close of Chromium left zombie chromium and crashpad processes in the pod. The image now starts through tini, which reaps them and forwards SIGTERM to the service.
-->

---
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

The puppeteer service closes Chromium after an idle period.

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: fix
title: Idle Chromium is closed after BROWSER_IDLE_TIMEOUT_MS
detail: The service kept Chromium running after the first render (about 480 MiB instead of 17 MiB idle). It now closes the browser after `BROWSER_IDLE_TIMEOUT_MS` (default 300000) without a render and launches it again on the next render, which pays a cold start. `/metrics` gains the gauge `puppeteer_browser_running`.
-->

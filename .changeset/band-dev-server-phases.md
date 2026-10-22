---
"@cosmicdrift/kumiko-dev-server": patch
---

createKumikoServer is split into named boot phases in their own files next to create-kumiko-server.ts. Routes, responses, log output, start and stop order and the public exports are unchanged.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Named boot phases for the dev server
detail: createKumikoServer now reads as a list of phases: client bundles, Tailwind stylesheet, HTML templates, stack boot, background runners, fetch handler, HTTP server, shutdown, file watchers and signal handlers. Each phase lives in its own create-kumiko-server-*.ts file. Request routing is a route table instead of one if chain, and the file watcher classifies changes through suffix and directory tables. Responses, headers, cookies, the reload stream, log lines, exit codes and the start and stop order stay the same. PROD_BUNDLES_ENV, STYLESHEET_WATCH_ENV and resolveStylesheet are still exported from the package index.
-->

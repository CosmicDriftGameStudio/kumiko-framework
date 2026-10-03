---
"@cosmicdrift/kumiko-dev-server": minor
---

`buildServerBundle` bundles an optional `bin/worker.ts` (next to `bin/main.ts`) as `dist-server/worker.js`, sharing chunks with the server entry.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Server bundle includes an optional worker entry
detail: |
  When `bin/worker.ts` sits next to `bin/main.ts`, `buildServerBundle` builds it in the same split build as `dist-server/worker.js`. Start a separate worker process from the same image with `exec bun run worker.js`.
-->

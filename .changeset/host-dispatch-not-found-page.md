---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

`hostDispatch` can answer `{ kind: "not-found" }` with a custom page. Prod takes `file` and optional `csp`, dev takes `file` or `entryName`. The page is served with status 404 instead of the plain "Not Found" text. Without those fields nothing changes.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: hostDispatch not-found can serve a custom 404 page
detail: |
  `HostDispatchResult` `{ kind: "not-found" }` accepts `file` (relative to `staticDir`) and `csp`. The page goes through the same delivery as `kind: "html"` (page head, `Vary: Host`, CSP) with status 404. A missing file answers 500 with the same message as `html`.
migration: |
  No code change needed.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: dev hostDispatch not-found can serve a custom 404 page
detail: |
  `DevHostDispatchResult` `{ kind: "not-found" }` accepts `file` (served like `static-html`) or `entryName` (that entry's shell), both with status 404. A missing file answers 500 with `hostDispatch: file not found`. Without fields the plain "Not Found" 404 stays.
migration: |
  No code change needed.
-->

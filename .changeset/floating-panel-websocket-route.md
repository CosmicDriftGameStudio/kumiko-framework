---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

FloatingPanel widget and r.webSocketRoute

renderer-web gains `FloatingPanel` (movable, resizable, non-modal panel with persisted geometry and a full-screen sheet on narrow viewports) and exports `useIsNarrowViewport`. Features can declare `r.webSocketRoute` under `/api/ws/` with session auth, an Origin check (allowlist, or same host without one), a per-route message cap and a 25 s heartbeat that revalidates session, roles and tenant lifecycle. `buildBunServeOptions` takes an optional upgrade handler as 4th argument and `runProdApp` handles expose `webSocketUpgradeFetch`; the dev server wires it. Additive, no migration.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: FloatingPanel widget and exported useIsNarrowViewport
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: r.webSocketRoute for authenticated WebSocket routes under /api/ws/
-->

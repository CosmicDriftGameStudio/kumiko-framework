---
"@cosmicdrift/kumiko-bundled-features": patch
---

Stricter input guards. A delivery channel plugin must declare `mode` as `inline` or `queued` and a function `render`, otherwise boot fails instead of silently dispatching inline. The derivatives-sharp overlay rejects a non-finite `marginPct` before it reaches sharp. A document-ingest provider can no longer register under the reserved name `unknown`, which marks upcast legacy ingest events. The unsubscribe POST route also accepts a JSON body.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Channel plugin guard validates mode and render
migration: |
  A delivery channel plugin must now declare `mode` as `"inline"` or `"queued"` and a function `render`; boot fails otherwise instead of dispatching inline.
-->

<!-- kumiko-changes
feature: derivatives-sharp
type: fix
title: Overlay marginPct must be finite
-->

<!-- kumiko-changes
feature: document-ingest-foundation
type: breaking
title: Provider name "unknown" is reserved for upcast legacy events
migration: |
  Registering a document-ingest provider under the name `unknown` now throws; rename any provider that uses it.
-->

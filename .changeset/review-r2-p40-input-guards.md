---
"@cosmicdrift/kumiko-bundled-features": patch
---

Stricter input guards. A delivery channel plugin must declare `mode` as `inline` or `queued` and a function `render`, otherwise boot fails instead of silently dispatching inline. The derivatives-sharp overlay rejects a non-finite `marginPct` before it reaches sharp. A document-ingest provider can no longer register under the reserved name `unknown`, which marks upcast legacy ingest events. The unsubscribe POST route also accepts a JSON body.

<!-- kumiko-changes
feature: delivery
type: fix
title: Channel plugin guard validates mode and render
-->

<!-- kumiko-changes
feature: derivatives-sharp
type: fix
title: Overlay marginPct must be finite
-->

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: Provider name "unknown" is reserved for upcast legacy events
-->

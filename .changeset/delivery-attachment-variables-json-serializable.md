---
"@cosmicdrift/kumiko-bundled-features": patch
---

Rendered-PDF attachment variables must be JSON-serializable

<!-- kumiko-changes
feature: delivery
type: fix
title: Rendered-PDF attachment variables must be JSON-serializable
detail: BigInt values or cycles in rendered-pdf variables now fail validation instead of throwing a TypeError that a retrying job hits again.
-->

---
"@cosmicdrift/kumiko-bundled-features": patch
---

The export cleanup job no longer logs "Gauge not registered" when metrics are switched off.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: export cleanup stays quiet when metrics are off
detail: The cleanup gauges are not registered without metrics, so the job logged "Gauge not registered" on every pass.
-->

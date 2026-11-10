---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Navigate targets given as a screen QN or a short id now resolve through one shared boot-validator helper, an unparseable 2xx `/rasterize` body is a final `RendererError` instead of being retried, a `null` field value no longer blocks AI-assist regeneration, and `isCurrencyOnlyMoney` is exported from the renderer headless barrel.

<!-- kumiko-changes
feature: framework
type: fix
title: Navigate targets resolve through one shared boot-validator helper
detail: Navigate targets given as a screen QN or a short id now resolve through one shared boot-validator helper.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: A null field value no longer blocks AI-assist regeneration
detail: A `null` field value no longer blocks AI-assist regeneration. `isCurrencyOnlyMoney` is exported from the renderer headless barrel.
-->

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: fix
title: An unparseable /rasterize response is a final error
detail: An unparseable 2xx `/rasterize` body is a final `RendererError` instead of being retried.
-->

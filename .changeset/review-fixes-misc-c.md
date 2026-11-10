---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Navigate targets given as a screen QN or a short id now resolve through one shared boot-validator helper, an unparseable 2xx `/rasterize` body is a final `RendererError` instead of being retried, a `null` field value no longer blocks AI-assist regeneration, and `isCurrencyOnlyMoney` is exported from the renderer headless barrel.

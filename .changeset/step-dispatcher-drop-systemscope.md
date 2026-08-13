---
"@cosmicdrift/kumiko-bundled-features": patch
---

`step-dispatcher` no longer declares `r.systemScope()` (fw#2068, part of fw#2056). The feature's only pattern is a `multiStreamProjection` whose apply handler drains deferred `webhook.send`/`mail.send` steps through `ctx.unsafeAppendEvent` — it never reads `ctx.db`/`ctx.systemDb`, and the MSP-apply context (`multi-stream-apply-context.ts`) is built independently of the `registry.isHandlerSystemScoped()` check that `r.systemScope()` feeds (that check is consumed only by `buildHandlerContext` for query/write/stream dispatch). Removing the unused flag is a no-op for the feature's behavior.

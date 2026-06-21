---
"@cosmicdrift/kumiko-dev-server": patch
---

Fix: any API handler reading `ctx.config` threw `errors.internal` in prod (first hit: the GDPR data-export download via `createFileProviderForTenant`). `runProdApp`/`runDevApp` wired `configResolver` into the AppContext but never `_configAccessorFactory`, so the dispatcher left `ctx.config` undefined. Boot now mints the factory from the **effective** resolver (an app-supplied configResolver override wins), restoring `ctx.config` for all handlers with dev/prod parity.

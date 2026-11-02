---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-feature-ast": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-testing": patch
---

The server bundle lists `meilisearch` as a runtime dependency when only a subpath such as `meilisearch/token` is imported, the ctx-namespaces codemod respects job contexts in structural context types, the type-aware codemod project passes redirect references and module mode to module resolution, and a job that uses the whole shutdown budget no longer starves the shutdown steps after it.

<!-- kumiko-changes
feature: dev-server
type: fix
title: subpath imports of an optional runtime external count as an import
detail: The server bundle only detected `import "meilisearch"`, so an app that imported just `meilisearch/token` and did not list `meilisearch` in its dependencies shipped a `dist-server/package.json` without it and crashed in production with `Cannot find package 'meilisearch'`. Subpath imports are detected now.
-->

<!-- kumiko-changes
feature: feature-ast
type: fix
title: ctx-namespaces codemod reads the context kind a structural parameter receives
detail: A structural context type that only a job context reaches kept being rewritten with the handler namespaces, for example `tracer` into `obs.tracer`, which `JobContext` does not carry. The codemod now collects the context kinds that reach the parameter: members that move the same way for all kinds are rewritten, members that move for one kind only are reported as manual. The type-aware project also forwards the redirected project reference and the module mode of the importing file to module resolution.
-->

<!-- kumiko-changes
feature: server-runtime
type: fix
title: job drain leaves a tail reserve of the shutdown budget
detail: The SIGTERM timer and the job drain in `stop()` used the same budget, so a job that ran the whole time ended the process with exit code 1 before the HTTP shutdown, the escape-hatch audit flush and the connection close ran. The job drain now gets the budget minus a 5 s reserve (at least 1 s). `KUMIKO_SHUTDOWN_DRAIN_TIMEOUT_MS` is the budget for both.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: e2e fixture client ip header also overrides a per-fetch x-forwarded-for
detail: The per-test client ip goes through `context.setExtraHTTPHeaders`, so an `x-forwarded-for` set in a single `fetch(..., { headers })` is replaced by it; only `page.setExtraHTTPHeaders` or a separate `browser.newContext()` with its own header changes the IP. This is now covered by `e2e/client-ip.spec.ts`.
migration: Specs that simulate other client IPs per request (rate limit, audit IP, geo) must set the header with `page.setExtraHTTPHeaders` or on their own `browser.newContext()`; a per-fetch `x-forwarded-for` is overwritten.
-->

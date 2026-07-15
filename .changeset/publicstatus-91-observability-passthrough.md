---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Add `./observability` subpath export to `@cosmicdrift/kumiko-framework` (the public barrel existed but wasn't wired into the exports map) and additive `observability`/`metrics` pass-through options to `runProdApp` (`@cosmicdrift/kumiko-dev-server`). Apps that don't set these keep the existing Noop-provider/no-`/metrics` behavior unchanged.

Prep work for publicstatus#91 (Job-Queue-Lane-Alert needs a real Prometheus meter — publicstatus currently exposes no `/metrics` endpoint at all).

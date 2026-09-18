---
"@cosmicdrift/kumiko-dev-server": minor
---

runDevApp gains resolvePageHead for dev/e2e parity with runProdApp

RunDevAppOptions/CreateKumikoServerOptions gain resolvePageHead, same PageHeadResolver signature as RunProdAppOptions. Applied to every templated HTML response (default single-entry shell and a host-dispatched "html" entry) via the shared @cosmicdrift/kumiko-headless/apex resolveAndInjectPageHead — same 300ms timeout, same error/null/timeout-falls-back-to-unchanged-200-shell semantics as prod (kumiko-framework#3026). The dev-only static-html hostDispatch kind (raw file passthrough, no bundle/schema injection either) is unaffected. No behavior change for apps that don't set resolvePageHead.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: runDevApp gains resolvePageHead for dev/e2e parity with runProdApp
-->

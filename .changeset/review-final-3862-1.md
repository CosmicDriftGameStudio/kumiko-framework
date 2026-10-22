---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

`runWorkerApp` and `runDevApp` accept `appOverrides`, merged exactly like in `runProdApp` (env bridge first, validated overrides on top). Before, an app that set tenant model, branding or SEO through `appOverrides` got those values in the API but env or default values in the mail layouts the worker renders and in the dev server. `runProdApp` with `runSingleInstance: false` now also warns to pass `appOverrides` to the worker.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: appOverrides work in runWorkerApp and runDevApp
detail: Both boot functions take the same appOverrides option as runProdApp and share its merge, so worker-rendered mails and the dev server resolve the same tenant model, branding and SEO values as the API. The runSingleInstance:false warning names appOverrides next to mail, fileStorage and featureToggles.
-->

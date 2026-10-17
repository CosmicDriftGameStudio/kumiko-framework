---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-guards": patch
---

Error boundaries keep a render error from blanking the whole page

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: A throwing screen shows an error card instead of a blank page
detail: createKumikoApp wraps the active screen in a boundary that keeps the shell and navigation visible, shows a card with the screen name and a reload action, and resets on route change. A second boundary around the whole app shows a minimal provider-free fallback. Both log the error with console.error. createKumikoApp takes an onError option for telemetry. kumiko-testing/e2e exports boundaryGuardedTest, a plain Playwright test that fails a spec when a boundary caught an error; the seeded test builds on it.
-->

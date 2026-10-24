---
"@cosmicdrift/kumiko-testing": patch
---

The puppeteer render tests, including the egress guard, run in CI.

<!-- kumiko-changes
feature: testing
type: improvement
title: The puppeteer render tests, including the egress guard, run in CI
detail: The integration job installs Chrome through the trusted puppeteer postinstall and caches it between runs, so the real render tests no longer skip in CI. Nothing changes for apps; the package is only republished.
-->

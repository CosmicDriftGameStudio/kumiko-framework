---
"@cosmicdrift/kumiko-testing": patch
---

CI runs the Playwright e2e suites in two shard jobs behind the required `e2e` check.

<!-- kumiko-changes
feature: testing
type: improvement
title: The e2e suites run in two parallel CI shards
detail: The framework CI splits the Playwright e2e suites across two runners instead of running them one after another on a single runner. The required e2e check passes only when both shards succeed. Nothing changes for apps; the package is only republished.
-->

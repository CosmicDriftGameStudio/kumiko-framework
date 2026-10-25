---
"@cosmicdrift/kumiko-guards": minor
---

comment-lang scans every source root of the framework repo

The comment-language guard no longer limits the framework repo to packages/*/src and now also scans samples, scripts, bin, packages/*/bin, apps/*/src and packages/renderer/e2e. App and library repos are unchanged, they already scanned all their source roots.

<!-- kumiko-changes
feature: guards
type: improvement
title: comment-lang scans every source root of the framework repo
-->

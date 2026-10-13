---
"@cosmicdrift/kumiko-guards": patch
---

comment-lang scans tooling repos, no longer rescans a division as a regex literal, and honours KUMIKO_PUSH_REPO_ROOT only when KUMIKO_CLI_SCOPE names that checkout. The scan-scope helpers scanFiles and scanRoots are exported.

<!-- kumiko-changes
feature: guards
type: fix
title: comment-lang guard scans tooling repos, handles division before a comment and ignores a stale KUMIKO_PUSH_REPO_ROOT
-->

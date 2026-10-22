---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-cli": patch
"create-kumiko-app": patch
---

`resolveFrameworkVersion` returns the exact framework version without a caret, and `scaffoldApp` resolves it itself instead of falling back to `"*"`. Freshly scaffolded apps now pass the exact-pin check of `kumiko check managed`. `scaffoldApp` throws when the version cannot be resolved and none is passed.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Scaffolded apps get exact framework pins
detail: resolveFrameworkVersion no longer prefixes ^ and scaffoldApp no longer falls back to "*", so a new app is green in kumiko check managed. Without a resolvable version and without an explicit frameworkVersion, scaffoldApp throws.
-->

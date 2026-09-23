---
"@cosmicdrift/kumiko-guards": minor
---

kumiko-guards ships the canonical `hooks/pre-push` shim that execs the nearest `node_modules/.bin/kumiko-pre-push` and fails closed with a `bun install` / `PRE_PUSH_SKIP=1` hint when it is missing; repos copy it to `.husky/pre-push`.

<!-- kumiko-changes
feature: guards
type: improvement
title: kumiko-guards ships the canonical `hooks/pre-push` shim that execs the nearest `node_modules/.bin/kumiko-pre-push` and fails closed with a `bun install` / `PRE_PUSH_SKIP=1` hint when it is missing; repos copy it to `.husky/pre-push`.
-->

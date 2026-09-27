---
"@cosmicdrift/kumiko-server-runtime": minor
---

requireEnv is now part of the public package export

requireEnv (the boot-time required-env-var check with context-aware error messages) was only reachable via a relative import of run-prod-app.ts. Consumers that need the same check for their own env vars (e.g. auth-mail overrides) can now do `import { requireEnv } from "@cosmicdrift/kumiko-server-runtime"`.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: requireEnv is now part of the public package export
detail: |
  `packages/server-runtime/src/index.ts` now re-exports `requireEnv`
  alongside `runProdApp`, so `import { requireEnv } from
  "@cosmicdrift/kumiko-server-runtime"` resolves without reaching into the
  internal `run-prod-app.ts` module.
-->

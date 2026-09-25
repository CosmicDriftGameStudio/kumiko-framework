---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-framework": patch
---

`test:real` now filters to `*.real.test.ts`, and real-provider runs share one 240s timeout budget (fw#3118)

<!-- kumiko-changes
feature: testing
type: fix
title: test:real now filters to *.real.test.ts, and real-provider runs share one 240s timeout budget
detail: |
  bunfig.real.toml's pathIgnorePatterns is blacklist-only (no gitignore-style
  negation), so an unfiltered `bun test --config=bunfig.real.toml` still ran
  the whole unit suite under the real-provider env. The generated `test:real`
  script now passes a positional `real.test.ts` filter. TEST_TIMEOUT_MS.real
  (bun --timeout) and E2E_TIMEOUT_MS.real (the Playwright real-run path via
  defineAppE2eConfig) now both come from the same 240_000 template constant
  instead of a separately hardcoded 120s, covering solon's real-provider
  document-onboarding flow. `isRealProviderRun(env?)` is exported next to
  `REAL_PROVIDERS_ENV`/`requireRealProviders` so apps stop duplicating the
  `KUMIKO_REAL_PROVIDERS === "1"` literal.
-->

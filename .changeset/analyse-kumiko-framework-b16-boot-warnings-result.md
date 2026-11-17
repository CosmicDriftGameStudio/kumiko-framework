---
"@cosmicdrift/kumiko-framework": patch
---

`validateBoot` returns the warnings it logs as `{ warnings }`.

<!-- kumiko-changes
feature: framework
type: improvement
title: validateBoot returns its warnings
detail: Boot warnings (unreachable nav screens, nav role inversions, toggleable dependencies, an incomplete production security baseline, single-use access roles, self-used APIs, an ephemeral or unconfigured GDPR export store, and the PII and retention hints) were only written to the `kumiko:boot` log, so apps checked them by spying on the console. `validateBoot` now returns `BootValidationResult` with `warnings: readonly BootWarning[]`; each warning has a `kind`, the `feature` where one applies, and the logged `message`. The log output is unchanged. `BootWarning`, `BootWarningKind` and `BootValidationResult` are exported from `@cosmicdrift/kumiko-framework/engine`.
migration: Boot tests that spied on `console.warn` for boot warnings can assert on `validateBoot(features, options).warnings` instead.
-->

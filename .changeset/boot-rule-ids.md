---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-guards": minor
---

Boot rules get stable ids. The measured hot spots (PII and retention, entityList, i18n, card meta columns, action icons, API and extension wiring, feature bootChecks, user-data-rights hooks) throw typed rule errors and report every violation of a run instead of the first. `agents/boot-rules.md` lists every rule with summary and fix, and the new `boot-raw-throws` guard keeps raw throws in boot validation from growing.

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot violations carry rule ids with a fix and a doc link
detail: 43 boot rules have an id such as `pii/subject-key-sortable` or `entity-list/default-sort-required`. A violation in `BootValidationError.violations` and in `kumiko-schema validate` (text and `--json`) carries that id instead of `unclassified/<check>`, plus a `Fix:` line and `Rule: agents/boot-rules.md#<id>`. PII field rules, entityList screen rules, missing i18n keys, API and extension usages and user-data-rights hooks now report all violations in one run. Message texts are unchanged. `@cosmicdrift/kumiko-framework/engine` exports `bootRuleError`, `BootRuleViolation`, `BootValidationError`, `collectBootRuleViolations` and the types `BootRule`, `BootRuleTable`, `BootViolation`, so a feature's `r.bootCheck` can throw a classified rule.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: New guard boot-raw-throws
detail: Freezes the count of raw `throw new Error` in `engine/boot-validator` and bundled `boot-checks.ts` per file in `.kumiko-boot-raw-throws-baseline.json`. New boot checks throw `bootRuleError(RULE, { message })` with a rule table. Only the framework repo is scanned.
-->

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: user-data-rights boot checks report rule ids
detail: The bootChecks of user-data-rights report `user-data-rights/empty-hook`, `user-data-rights/export-without-delete` and `user-data-rights/missing-hook` with a fix, and list every missing or empty hook of a run instead of stopping at the first. Message texts are unchanged.
-->

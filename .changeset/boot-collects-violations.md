---
"@cosmicdrift/kumiko-framework": minor
---

validateBoot collects every violation of a phase and throws them as one BootValidationError instead of stopping at the first.

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot validation reports all violations at once
detail: validateBoot runs its checks in phases and collects the violations of each phase into one BootValidationError with a `violations` list (ruleId, check, feature, message). Structural violations (duplicate API names, screen short-id collisions, unresolved query references, circular dependencies, extension usages, API exposure, reference fields, parent refs) abort before the per-feature and app-wide checks, which would only echo them. The error message starts with `Boot validation failed: N violation(s)` followed by one line per violation, each keeping its original text. A feature whose action or field wiring is invalid skips its screen check. `kumiko-schema validate` prints one ✗ line per violation and takes `--json`, which prints a single JSON document on stdout and moves the human lines to stderr.
-->

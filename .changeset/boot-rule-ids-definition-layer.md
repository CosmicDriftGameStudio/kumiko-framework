---
"@cosmicdrift/kumiko-framework": minor
---

Errors thrown while `kumiko/schema.ts` loads now carry boot rule ids, and `kumiko-schema validate` reports all of them in one run. The registrar methods (`r.nav`, `r.screen`, `r.hook`, `r.writeHandler`, `r.defineEvent`, `r.probe` and the rest), field factories, `from()` and role assignment throw typed rule errors from ten new tables, so `agents/boot-rules.md` lists 112 more rules.

<!-- kumiko-changes
feature: framework
type: improvement
title: Definition errors in schema.ts are collected by validate
detail: `kumiko-schema validate` (and `kumiko check`) loads `kumiko/schema.ts` in a collect mode. Every failing registrar call and every failing feature setup is recorded instead of aborting the import, so one run prints one `✗ boot [<id>]` line per violation across all features, with `Fix:` and `Rule:` lines, and `--json` lists them in `boot.violations` with `check` (e.g. `r.nav`) and `feature`. Example ids: `nav/id-not-kebab`, `feature/describe-twice`, `handler/access-missing`, `event/pii-stance-empty`, `probe/name-not-kebab`. When such violations exist, validate skips the boot and migration checks, because the feature set is incomplete. Outside validate nothing changes: createApp, the server, the dev server and tests still throw at the first error, at the same place and with the same message; the thrown error is now a `BootRuleViolation` (a subclass of `Error`). A throw at module level outside `defineFeature` still stops the import and appears next to the violations collected before it.
-->

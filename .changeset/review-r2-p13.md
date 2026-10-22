---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": patch
---

Review fixes: stricter boot checks for handler field references and `r.requires`, `r.bootCheck` failures no longer get a redundant suffix, embedded lists keep `minItems` in the JSON schema, and tests share one console-call filter helper.

<!-- kumiko-changes
feature: framework
type: fix
title: Unknown keys in a handler field references meta fail the boot
detail: A references meta such as `{ entity: "channel", bY: "key" }` is reported as invalid instead of silently reading as an id reference, so a misspelled `by` can no longer turn a business-key field into an id field.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: r.requires rejects malformed arguments
detail: `r.requires` now throws when called with more than one argument or without a `features` string array, instead of dropping extra arguments or registering the object as a dependency name.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: r.bootCheck failures keep the check's own message
detail: The boot error no longer appends a generic sentence, so messages ending in a period are not doubled and the check's text is the whole explanation.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Embedded list minimum stays in the JSON schema
detail: A required or `minItems` embedded list again reports `minItems` in `z.toJSONSchema` output, so agent manifests tell callers that at least one row is needed.
-->

<!-- kumiko-changes
feature: testing
type: fix
title: consoleCallsMentioning helper for console spies
detail: `@cosmicdrift/kumiko-testing/helpers` exports `consoleCallsMentioning(spy, fragment)` and `ConsoleSpyLike`, replacing the per-file filters tests used to ignore console output of other test files.
-->

---
"@cosmicdrift/kumiko-guards": patch
---

The hard complexity cap drops from 60 to 40. The thin-wrapper guard no longer reports functions that fill a slot of a typed table.

<!-- kumiko-changes
feature: guards
type: improvement
title: Complexity hard cap 40, thin-wrapper guard skips typed table slots
detail: A function above complexity 40 in the repo's own files fails the complexity guard, independent of the complexity baseline and of the complexity-budget tag, also with --no-baseline. The thin-wrapper guard skips a function that is a value of an object literal with a declared type or a satisfies check, inline or referenced by name, because the table fixes its signature.
migration: Split every function above complexity 40 before the bump; the complexity-budget tag and the baseline do not cover it. `bun check-complexity.ts --all --no-baseline` lists them under "Above hard cap".
-->

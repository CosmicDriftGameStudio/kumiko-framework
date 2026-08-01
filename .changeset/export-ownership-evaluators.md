---
"@cosmicdrift/kumiko-framework": patch
---

Export `buildOwnershipClause`, `userCanReadFieldRow`, and `userCanWriteFieldRow` from `@cosmicdrift/kumiko-framework/engine` (alongside the already-exported `from`). Consumers whose feature code bypasses the generic entity handlers (e.g. a hand-rolled `selectMany` lookup) can now gate that raw path against the same `EntityDefinition.access` ownership rules the executor already enforces on list/detail/create/update/delete, instead of reimplementing the check. No behavior change — pure export addition, `ownership.ts` itself is untouched.

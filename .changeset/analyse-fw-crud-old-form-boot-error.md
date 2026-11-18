---
"@cosmicdrift/kumiko-framework": patch
---

`r.crud` called in the old name-first form or with an entity without a name fails at boot with `registrar/options-object-required` and a fix hint instead of a TypeError from the table naming.

<!-- kumiko-changes
feature: framework-core
type: fix
title: r.crud in the old form fails with a boot rule instead of a TypeError
detail: Untyped callers, such as JavaScript or code generated for an older framework, still called `r.crud("name", entity, options)` or passed an entity without `name`. The first ended in the misleading message "r.entity() takes one options object", the second in `TypeError: str.replace is not a function` from `toTableName`. Both now throw `registrar/options-object-required` with the message that `r.crud(entity, options)` takes an entity created with `createEntity({ name, ... })` and that `bun kumiko-upgrade --apply` moves the name.
-->

---
"@cosmicdrift/kumiko-framework": patch
---

An optional `select` field **with** a `default` now treats an untouched `<select>`'s `""` as "use the default" on insert instead of rejecting it as an invalid enum value (#1702). Update schemas keep their existing behavior — they strip defaults deliberately, so there `""` still maps to an explicit clear-to-null.

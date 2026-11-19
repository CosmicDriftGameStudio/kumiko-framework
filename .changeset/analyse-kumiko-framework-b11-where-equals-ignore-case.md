---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

The where DSL gets `equalsIgnoreCase` for case-insensitive equality.

<!-- kumiko-changes
feature: framework
type: improvement
title: equalsIgnoreCase where operator
detail: `{ field: { equalsIgnoreCase: value } }` compares `lower(column) = lower(value)`, so input matches regardless of case in SQL instead of loading rows to compare them in JavaScript. `%`, `_` and `\` in the value have no wildcard meaning, and surrounding whitespace is not trimmed. The value must be a string; like the pattern operators it matches nothing on a jsonb column.
-->

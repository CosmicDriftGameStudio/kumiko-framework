---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The where DSL gets `contains` and `startsWith`, which match user input literally; `like` stays a raw pattern.

<!-- kumiko-changes
feature: framework
type: improvement
title: contains and startsWith where operators escape wildcards
detail: `{ like }` passes its pattern unchanged, so `%` and `_` from user input act as wildcards unless the caller escapes them. `{ contains: value }` and `{ startsWith: value }` escape `%`, `_` and `\` themselves and match a substring or a prefix with LIKE. Like `like`, they match nothing on a jsonb column. The audit search and the form-draft lookup use them instead of their own escape helpers.
-->

---
"@cosmicdrift/kumiko-guards": patch
---

Escape-hatch guard recognizes `r.useExtension(...)` hook options

`guard-escape-hatch-declared.ts` only recognized `escapeHatch` on a literal `handler` property, or on the options argument of `r.hook`/`writeHandler`/`queryHandler`/`streamHandler`. `r.useExtension(ext, entityName, { export, escapeHatch })`-style hooks (`export`, `forget`, ...) matched neither shape, so a correctly declared `escapeHatch` grant on a `useExtension` options object still flagged `unsafeRaw` inside its hook functions as `unsafe-raw-outside-system-scope`.

The guard now also recognizes any function property of an object literal that declares `escapeHatch` and is passed directly as an argument to a call whose callee is a `useExtension` property access — matching the runtime per-usage grant scope exactly. The pre-existing `handler` recognition is unchanged.

<!-- kumiko-changes
feature: guards
type: fix
title: Escape-hatch guard recognizes r.useExtension(...) hook options
-->

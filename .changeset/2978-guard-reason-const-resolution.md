---
"@cosmicdrift/kumiko-guards": patch
---

Escape-Hatch-Declared Guard resolves module-local const reasons instead of forcing duplicate literals

`_lib/generic-reason.ts`'s `literalReasonText` only accepted a string/template literal in place — an Identifier (even a module-local `const SOME_REASON = "..."`) fell through as "not statically judgeable" and was rejected exactly like a real placeholder. Every consumer declaring several hooks with the same justification (e.g. publicstatus's five GDPR delete hooks) had to repeat the same reason text literally in each `declareEscapeHatch({ reason })` / `escapeHatch: { reason }` / `unsafeAllTenants: { reason }` / `acknowledgeCrossTenant(reason)` call, because a shared constant made the guard fail.

The guard now resolves an Identifier to a module-local `const` initializer (string or non-templated template literal only — no imports, no `let`, no reassignment) via a new `resolveReasonText`, used at all four call sites; `isGenericReason` is unchanged and still applies to the resolved text, so a const resolving to `"todo"` is rejected exactly as before. An import, a function call, or a template literal with substitutions still doesn't resolve, and the `unsafe-raw-outside-system-scope` / `system-identity-outside-declared-scope` findings now say why when a nearby `declareEscapeHatch` call's reason is one of those three shapes. Both R2 and R3's base messages now also name `declareEscapeHatch({ reason: "..." })` as a direct body statement of a named hook among the allowed ways to clear the finding.

<!-- kumiko-changes
feature: guards
type: fix
title: Escape-Hatch-Declared Guard resolves a module-local const reason instead of forcing duplicate literals
-->

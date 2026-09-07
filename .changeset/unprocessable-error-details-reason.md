---
"@cosmicdrift/kumiko-framework": minor
---

Documents the breaking `UnprocessableOpts.details` tightening from #2460 (never released with a changeset) and ships a codemod for it.

`UnprocessableError` folds its positional `reason` argument into `details` internally (`{ ...opts?.details, reason }`); `details` can no longer declare its own `reason` key (`Readonly<Record<string, unknown>> & { readonly reason?: never }`), so a caller that duplicated `reason` inside `details` now fails to compile (TS2322) instead of having it silently overwritten.

New `scripts/codemod/unprocessable-error-details-reason.ts`, wired into `packages/framework/src/changes.json` as `0.235.0`'s `codemod` field — `kumiko upgrade --apply` removes the redundant `details.reason` property automatically. Sites it can't safely resolve mechanically (a spread inside `details`, a non-literal `details` value, a same-named non-framework class) are left untouched and reported with file:line.

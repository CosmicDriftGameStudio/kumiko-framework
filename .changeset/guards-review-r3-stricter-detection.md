---
"@cosmicdrift/kumiko-guards": patch
---

Stricter guard detection; app repos that carried an undetected pattern can now turn red.

- `guard-raw-sql`: only kumiko-platform is skipped. An app repo whose declared `sourceRoots` all do not exist now fails as vacuous (0 files scanned) instead of passing.
- `test-template-drift`: `...defineAppE2eConfig(...)` spread next to `fullyParallel`, `retries`, `timeout`, `workers` or `expect`, and shorthand `{ viewport }` / `{ deviceScaleFactor }`, are flagged.
- `no-framed-extension-sections`: an `extensionSectionComponents` registry held in a variable, shorthand or spread is resolved.
- `runtime-isolation`: entries declared in package.json `kumiko.clientEntry` / `kumiko.clientEntries[].sourceFile` count as browser code.
- `test-stack-drift`: `@no-server-stack:` only opts out when it sits in a comment, not in a string literal.
- Direct `run-guards.ts` / `run-ui-guards.ts` / `run-repo-checks.ts` invocations exit with 1 instead of the failure count.

<!-- kumiko-changes
feature: guards
type: improvement
title: Stricter guard detection for raw-sql, test-template-drift, framed extension sections, runtime-isolation and test-stack-drift
migration: |
  App repos that carried a previously undetected pattern can now fail their guards. Fix the reported sites; a vacuous raw-sql scan (all declared sourceRoots missing) must declare existing source roots.
-->

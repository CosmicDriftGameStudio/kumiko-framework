---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko-upgrade --apply` no longer crashes on pending changelog entries whose `codemod` field is a shell command instead of a `scripts/codemod/`-relative path: the 0.267.0 entry's `codemod` pointed at `scripts/migrate-db-raw.ts --dry-run <paths>`, a repo-root script never shipped in the published package. `migrate-db-raw.ts` now ships at `packages/framework/src/scripts/codemod/migrate-db-raw.ts`, resolved the same way as every other codemod.

# consumer-facing codemods

This directory holds the codemod scripts `kumiko upgrade --apply` runs for
consumers of `@cosmicdrift/kumiko-framework`. It ships as part of the
published package (under `src/`), unlike `scripts/codemod/` at the repo
root, which is internal bun-cutover tooling for this repo's own migration
and never gets published.

`crypto-shredding-testing-move.ts` rewrites the moved
`resetPiiSubjectKmsForTests` import path; it's wired into
`packages/bundled-features/src/crypto-shredding/changes.json`'s `codemod`
field and runs automatically via `kumiko upgrade --apply`.

## pii-personal-migration.ts

Migrates `create*Field(...)` calls from the old flag-based PII API (`pii`,
`userOwned`, `tenantOwned`, `subjectRef`, `allowPlaintext`, `lookupable`,
`searchable`, `sensitive`) to the author-facing `personal`/`find` API
(kumiko-framework#2250). Idempotent — safe to re-run against already
migrated code (no-ops on fields carrying `personal`).

`createTenantConfig`/`createUserConfig`/etc. are out of scope by
construction (name doesn't match `create*Field`).

```bash
bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/pii-personal-migration.ts <targetDir> [--dry-run]
```

Anything it can't map mechanically (two subject flags on one field,
`sensitive` + `lookupable`/`searchable` together, `piiEncrypted` on an
entity field, a raw object literal with subject flags outside a
`create*Field(...)` call) is reported with file:line instead of guessed
at — fix those by hand. The report also lists every field that newly
gains `lookupable` (searchable-only fields resolving to `find: "fuzzy"`)
— each of those needs a `_bidx` column migration, which this script does
not write.

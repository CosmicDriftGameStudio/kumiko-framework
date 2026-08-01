---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

Dedup and dead-code cleanup with two breaking removals:

- `schedulerIdForJobName` is no longer exported from `@cosmicdrift/kumiko-framework/jobs` — it was only ever called internally by the job runner.
- `ManifestFeature.changelog` is removed — the field was never populated by the manifest builder.
- `ReferenceCreateDialogProps.translate` is removed from `@cosmicdrift/kumiko-renderer` — the dialog already resolves translations via `useTranslation()` internally, the prop was dead.

`compareVersions`/`ChangelogEntry`/changelog parsing in `bin/commands/upgrade.ts` and `scripts/gen-migration-guide.ts` now import the shared implementation from `@cosmicdrift/kumiko-framework/engine` instead of duplicating it.

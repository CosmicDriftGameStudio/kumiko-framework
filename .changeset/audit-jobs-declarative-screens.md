---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
---

`audit` and `jobs` bundled features now use declarative screens (`projectionList`/`projectionDetail`) instead of custom React components: `audit-log`/`audit-log-detail` and `job-runs`/`job-run-detail` render through the generic renderer, and job triggering moved to a new `job-trigger` `actionForm` opened via a drawer `toolbarAction` on `job-runs`.

Removed exports (dead since the renderer selects screens by `screen.type`, not the client component registry): `AuditLogScreen`, `AuditLogDetailScreen`, `JobRunsScreen`, `JobRunDetailScreen` from `@cosmicdrift/kumiko-bundled-features`. No shipped consumer app imported these.

Adds a `json` field-renderer format (`EditFieldSpec.renderer.format`, `@cosmicdrift/kumiko-types` + `@cosmicdrift/kumiko-headless`) that pretty-prints a JSON-string field instead of showing the raw escaped string; used by the new `job-run-detail` screen's `logs` field.

---
"@cosmicdrift/kumiko-bundled-features": minor
---

Add read-only operator inspector screens to the `user-data-rights` feature: SystemAdmin-gated `entityList` + read-only `entityEdit` screens over the GDPR `export-job` (list + detail) and `download-attempt` (list) read-models, plus the convention `:list`/`:detail` query handlers so they resolve by QN. The screens are inert until an app navs them (opt-in at wire time). Because both entities are event-sourced `r.entity` rows, binding `entityList` is rebuild-safe — direct-write read-models like `jobs`/`sessions` still need a separate query-bound primitive (follow-up).

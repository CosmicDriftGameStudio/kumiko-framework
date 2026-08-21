---
"@cosmicdrift/kumiko-framework": patch
---

kumiko-upgrade: add `installedVersion` to `--json` output. `currentVersion` still echoes `--from` when given (unchanged filter baseline), but it previously masked the actually installed `@cosmicdrift/kumiko-bundled-features`/`kumiko-framework` version whenever `--from` was passed — the new field always reflects what `readCurrentVersion` detects, independent of `--from`.

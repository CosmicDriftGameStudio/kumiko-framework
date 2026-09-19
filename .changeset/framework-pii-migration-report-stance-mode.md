---
"@cosmicdrift/kumiko-framework": patch
---

pii-personal-migration codemod: `--report-stance` mode (fw#2919)

`bun scripts/codemod/pii-personal-migration.ts <dir> --report-stance` scans every `createTextField`/`createLongTextField` call without a `personal` stance and classifies its field name against the `entity-handler.ts` PII name hints (direct/user-owned/user-reference/near-miss/unclassified) — no files are written.

<!-- kumiko-changes
feature: framework
type: improvement
title: pii-personal-migration codemod gets a --report-stance mode (fw#2919)
-->

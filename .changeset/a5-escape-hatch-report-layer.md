---
"@cosmicdrift/kumiko-framework": patch
---

Move escape-hatch report deduplication from `pipeline/` to `observability/`,
so the db layer no longer pulls in the pipeline module graph at runtime; the
public API is unchanged.

<!-- kumiko-changes
feature: framework
type: improvement
title: Move escape-hatch reporting from pipeline to observability
detail: escape-hatch-report.ts now lives in observability/ instead of pipeline/, removing a runtime layering violation where the db layer imported from pipeline; the public API (@cosmicdrift/kumiko-framework/pipeline exports) is unchanged.
-->

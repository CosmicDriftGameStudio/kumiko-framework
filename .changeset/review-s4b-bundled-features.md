---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Metric integer filters reject fractions and out-of-range values; feature-name constants exported

<!-- kumiko-changes
feature: metrics
type: fix
title: Metric integer filters reject fractions and out-of-range values; feature-name constants exported
detail: Filters on smallint, integer and bigint columns now fail validation for decimals and values outside the column range instead of a Postgres cast error. FILES_FEATURE and FILES_TENANT_DATA_FEATURE are exported and reused by compose-features.
-->

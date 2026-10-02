---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Retention hardDelete on entities with file fields now pages by id, so rows stuck on a storage failure or a missing file storage no longer starve the rows behind them. A `blockDelete` entity with a personal field but no `anonymize` function is reported as `missing_anonymize_fields` again after the hold expires; only entities without any anonymizable subject field stay silent. The framework exports `entityHasAnonymizableSubjectField` for this check.

<!-- kumiko-changes
feature: data-retention
type: fix
title: Retention hardDelete pages past stuck file rows and blockDelete reports personal fields without anonymize
-->

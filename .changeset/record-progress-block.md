---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

projectionDetail screens take a `progress` block that shows the process chains a record is part of.

<!-- kumiko-changes
feature: renderer
type: feature
title: Record progress block for projection detail screens
detail: projectionDetail takes `progress: { field }`; the query returns `RecordProgress[]` (`title`, `steps` with `id`, `label`, `done`, optional `detail`, and `currentIndex`) in that field. Each chain renders as a step bar between the banner and the steps panel, with done steps marked and the current step as "up next". An empty array hides the block, and boot validation rejects an empty field name (`projection-detail/guidance-field-empty`).
-->

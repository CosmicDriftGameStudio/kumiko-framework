---
"@cosmicdrift/kumiko-guards": minor
---

As-casts guard fails on baseline regressions

<!-- kumiko-changes
feature: guards
type: improvement
title: As-casts guard fails on baseline regressions
detail: check-as-casts now returns violations for more suspect casts per file and target than the baseline, for unknown or missing @cast-boundary reasons in repo-local files (only when a baseline exists), and for a baseline with a drifted format. Repos without a baseline and sibling checkouts under ../ still only warn.
-->

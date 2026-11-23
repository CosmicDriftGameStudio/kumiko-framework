---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

projectionList `defaultNamedFilter` opens the list with one named filter active.

<!-- kumiko-changes
feature: renderer
type: improvement
title: projectionList can open with a default named filter
detail: `defaultNamedFilter` names one id of `namedFilters`. While the URL carries no filter, that chip is active and the filter is sent with every list and count query, also when the list is embedded as a dashboard screen panel. The user switches to another chip; the default itself cannot be switched off. Boot fails when the id is not in `namedFilters`.
-->

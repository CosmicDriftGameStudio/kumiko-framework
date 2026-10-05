---
"@cosmicdrift/kumiko-types": patch
---

ContainsSecret works on recursive types

`ContainsSecret<T>` stops after eight levels of nesting. Query handlers whose output contains `DashboardI18nText` (which refers to itself through `i18nParams`) no longer fail to compile with TS2615. A secret nested deeper than that is still caught by the runtime leak guard.

<!-- kumiko-changes
feature: types
type: fix
title: ContainsSecret no longer fails with TS2615 on recursive types such as DashboardI18nText
-->

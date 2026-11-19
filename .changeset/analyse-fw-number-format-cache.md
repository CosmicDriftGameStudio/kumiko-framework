---
"@cosmicdrift/kumiko-renderer": patch
---

Lists and tables with many amounts and numbers render faster because the number formatters are reused.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Number and money formatting reuses its formatters
detail: formatMoney, the number and unit cells of applyFormatSpec, formatDocumentPercent, read-only number fields and the number value chips of a form field keep one Intl.NumberFormat per locale and option set instead of building one per value, and remember the resolved locale per input. The cache is capped and cleared when full, because locale and currency can come from user data. Output is unchanged.
-->

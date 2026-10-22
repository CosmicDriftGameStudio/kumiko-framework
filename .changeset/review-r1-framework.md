---
"@cosmicdrift/kumiko-framework": patch
---

Review fixes: deferred notify with non-cloneable data, form derivation currency and unit checks, metric label i18n keys, round-trip of backingTable, empty nav groups of disabled features, global-write audit per table.

<!-- kumiko-changes
feature: framework
type: fix
title: Review fixes for notify, form derivations, i18n keys, feature AST, nav stripping and escape-hatch audit
detail: A deferred ctx.notify with Temporal values in data no longer fails the write. Form derivations take the literal currency or the source currency before the client value, reject mixed-currency operands, and the boot validator now rejects derive definitions that mix money with number/decimal units or use non-numeric sources. Metric labels of projectionDetail screens are required i18n keys. The feature AST keeps backingTable on spread entity definitions. Pure grouping navs emptied by disabled features are removed. db.global() writes are audited per table.
-->

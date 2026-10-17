---
"@cosmicdrift/kumiko-framework": patch
---

moneyAmount is typed as a bigint column

<!-- kumiko-changes
feature: framework
type: breaking
title: moneyAmount returns ColumnBuilder<bigint> instead of ColumnBuilder<number>
detail: The column was always created with bigint mode, so the driver returned a bigint while the type said number. The type now matches the runtime value. Code that assigned the column value to a number or did number arithmetic on it no longer typechecks.
migration: Treat values read from a moneyAmount column as bigint (for example compare with 0n, or convert explicitly with Number() where the amount is known to fit). No schema change.
-->

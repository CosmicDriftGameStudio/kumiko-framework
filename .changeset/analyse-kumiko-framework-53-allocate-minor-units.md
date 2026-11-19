---
"@cosmicdrift/kumiko-types": patch
---

`allocateMinorUnits` from `@cosmicdrift/kumiko-types/minor-units` splits an amount into whole minor units by weight, and the parts always add up to the amount.

<!-- kumiko-changes
feature: types
type: improvement
title: allocateMinorUnits splits money into whole cents by weight
detail: `allocateMinorUnits(totalMinor, [{ key, weight }])` returns a `ReadonlyMap` from key to share in whole minor units. It uses the largest-remainder method, so the shares add up to `totalMinor` exactly, also for negative amounts. Ties go to the smaller key, so the result does not depend on the order of the input, and a projection rebuild gives the same cents. A total that is not a safe integer, a negative or non-finite weight, a repeated key, or a non-zero total over weights that sum to 0 throws a `RangeError` instead of losing money.
-->

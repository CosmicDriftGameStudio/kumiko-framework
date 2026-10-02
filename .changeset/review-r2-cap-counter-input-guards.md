---
"@cosmicdrift/kumiko-bundled-features": patch
---

`bookCapUsage` and `markCapSoftWarned` now reject a `periodStartIso` that is not an ISO instant with a validation error instead of silently forking a counter row or throwing a `RangeError`. `enforceCap` rejects a non-integer or non-positive `amount` instead of letting it bypass the cap. `enforceCapAndMaybeNotify` surfaces a failed soft-warn write instead of re-sending the notification on the next call. The cap-counter list now has German column labels.

<!-- kumiko-changes
feature: cap-counter
type: fix
title: Cap helpers validate periodStartIso and amount, surface failed soft-warn writes; German column labels
-->

---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
---

Number and decimal formats take minimumFractionDigits and maximumFractionDigits.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Fraction digits for number and decimal formats
detail: { format: "number" | "decimal", maximumFractionDigits: 4 } renders 0.0004 as 0.0004 (de: 0,0004) instead of 0; minimumFractionDigits pads. Integers 0 to 20 with min not above max; anything else is ignored and the Intl default (3 digits) applies, so existing formats render unchanged.
-->

---
"@cosmicdrift/kumiko-framework": patch
---

Embedded-list derived cells (multiply/sum/subtract) are now rounded kaufmännisch (half-away-from-zero) to the target sub-field's declared precision — integer minor units for `money`, `scale` for `decimal` — before validation, both server-side (write schema) and client-side (live preview). Previously a fractional product on a money/decimal target was rejected outright with a 422.

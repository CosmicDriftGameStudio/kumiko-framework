---
"@cosmicdrift/kumiko-framework": patch
---

A `totalsMatch` pair is now validated as a unit. A payload that carries only the embedded list or only its sibling money field is rejected with a validation error, because update payloads only carry `changes` and the sum could otherwise drift away from the total.

<!-- kumiko-changes
feature: framework
type: breaking
title: totalsMatch rejects a payload that carries only one side of the pair
migration: |
  Send the embedded list and its sibling money field together in every create and update payload. A partial update that changes only `total` or only the list now fails validation.
-->

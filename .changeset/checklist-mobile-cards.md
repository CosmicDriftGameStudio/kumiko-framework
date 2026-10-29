---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Embedded-list phone cards show only the checkpoint and its controls, and number cells format the same way in display and input.

<!-- kumiko-changes
feature: framework
type: improvement
title: Slimmer checklist cards and locale numbers in embedded lists
detail: On narrow screens an embedded list with an `inRange` derived cell no longer shows the min and max sub-fields as their own rows. The card shows them as a hint under the measured value ("Limit 0.05 to 0.2", "At least …", "At most …"; new keys `kumiko.field.embedded-list.limit-range`, `limit-min`, `limit-max`). The result badge sits next to the measured value without a label. The new `embeddedList.cardHiddenCells` on an entityEdit field hides sub-fields that only steer a row (such as the kind of a checkpoint) on phone cards; boot rejects names that are not sub-fields. The desktop table is unchanged. Number and decimal cells now use the locale text input (`NumberInput`) instead of a native `type="number"`, so input and read-only cells share one locale format ("0,31" in de, "0.31" in en). Tests that located these cells by role `spinbutton` must use `textbox`.
-->

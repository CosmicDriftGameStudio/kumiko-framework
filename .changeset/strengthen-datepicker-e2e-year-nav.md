---
"@cosmicdrift/kumiko-framework": patch
---

Strengthen the date-picker e2e year-navigation assertion (#411/1): the test
now pins that the calendar grid actually navigated to the selected year by
asserting a day-button carries that year in its accessible name, instead of
only checking the `<select>`'s DOM value. An uncontrolled select would keep the
old assertion green even if its `onChange` never fired and the grid stayed put;
the added check fails in exactly that case.

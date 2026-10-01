---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-framework": patch
---

NumberInput selects its value on focus, createScreen counts as nav parent, NumberField passes grouping, mobile card subtitles name boolean columns

Focusing a prefilled `NumberInput` swapped the grouped display ("10.000") for the raw value and left the cursor at the end, so typing or Playwright's `fill("100")` appended ("10000100"). The raw value is now selected on focus, like `MoneyInput`; a click therefore no longer places the caret. A screen reached only through an entityList's `createScreen` now resolves that list as its parent, so the nav-area boot check passes without `listScreenId` and the breadcrumb shows the list. `NumberField` forwards `grouping` to the number input. In the mobile card layout a true boolean column shows its column label in the subtitle line instead of a bare check mark; false and blank values (including whitespace) are left out together with their separator.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: NumberInput selects on focus, createScreen counts as nav parent, mobile card subtitles name boolean columns
migration: |
  None. Tests that read a bare check mark from a mobile card subtitle now find the column label.
-->

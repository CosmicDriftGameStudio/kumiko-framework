---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer": patch
---

Number fields use a locale-aware text input (role textbox, not spinbutton)

Number, bigInt and decimal fields render a text input (role `textbox`) with a decimal or numeric keypad instead of `<input type="number">`. The blurred value is formatted with the app locale and the field `grouping` option (false hides the thousands separator); while focused the raw value is edited. Invalid locale tags fall back to en-US instead of throwing. Numeric and date table cells use tabular figures; the global body default is removed.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Number fields use a locale-aware text input (role textbox, not spinbutton)
migration: |
  Number inputs are now text inputs. Tests that query a number field by the `spinbutton` role must use `textbox`; code that read `input.valueAsNumber` must parse `input.value`.
-->

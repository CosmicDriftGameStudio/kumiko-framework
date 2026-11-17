---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
---

`renderer: { format: "money" }` formats a money value `{ amount, currency }` in its own currency, so projectionDetail fields, headers and metrics can take the raw value from the query.

<!-- kumiko-changes
feature: renderer
type: improvement
title: FormatSpec "money" for money values
detail: A projectionDetail query that returned a money field as read by the executor (`{ amount, currency }`, amount in major units) had no format to show it: `format: "currency"` needs a fixed currency code and a number, and the synthesized display entity types every field as text. `{ format: "money", locale? }` formats such a value with Intl in the value's own currency and the UI locale, on layout fields (`renderer`), header `statusFormat`, metric `format` and list column renderers. Values that are not a money value render as their text, an object renders empty.
-->

---
"@cosmicdrift/kumiko-renderer": patch
---

fw#2763: a `navigate` param now correctly prefills a money field — a JSON `{amount, currency}` value is parsed and carried through as the structured shape instead of collapsing to a bare number or a stray "[object Object]", and `stringifyNavParams` now encodes a plain-object row value (such as a money field) as JSON instead of `String()`-ing it. When the currency can't be determined (a bare number with no `defaultCurrency` in scope, e.g. in an actionForm), the prefill now emits a dev warning instead of silently producing a value the handler's zod schema rejects on submit; a currency read from the param is validated against the ISO-4217 three-letter format, so a malformed code falls back to the field default instead of crashing the form render in `Intl.NumberFormat`.

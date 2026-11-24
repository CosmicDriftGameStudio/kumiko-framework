---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A number config key can carry a `currency`, so its generated settings mask shows an amount field.

<!-- kumiko-changes
feature: config
type: improvement
title: Config keys of type number can declare a currency and show an amount field
detail: `currency: { kind: "literal", code }` (or `{ kind: "tenant" }`) on a number config key marks the stored integer as an amount in the smallest currency unit. The generated settings mask then shows a money field instead of a plain number, and `config:query:schema` returns the `currency`. Boot rejects `currency` on a non-number key, and `createApp` checks a literal code against the app's `currencies`. The stored value does not change.
-->

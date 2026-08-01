---
"@cosmicdrift/kumiko-renderer-web": patch
---

`parseIso`/`parseTypedDate` now reject years above 9999, matching the existing lower-bound guard. `Temporal.PlainDate.toString()` switches to the signed extended ISO format (`+010000-04-25`) above that range, which broke the DateField wire contract of always emitting a plain `yyyy-mm-dd` string. Values with a 5+ digit year now parse to `undefined` instead of producing a malformed ISO string.

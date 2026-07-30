---
"@cosmicdrift/kumiko-renderer-web": patch
---

`date-parse.ts` (internal, not re-exported from the package's public entrypoints) now works with `Temporal.PlainDate` instead of native `Date`. Adds `temporal-polyfill` as a runtime dependency. `DateField`'s public props (`value`/`onChange`/`min`/`max`) are unchanged ISO strings — the conversion is fully contained inside `date-parse.ts` and `date-field.tsx` (kumiko-framework#1656).

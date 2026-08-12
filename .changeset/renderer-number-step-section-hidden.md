---
"@cosmicdrift/kumiko-renderer": patch
---

`InputProps` (kind: "number") gained an optional `step?: number | "any"` field, forwarded to the native `<input step>` — set it to `"any"` to disable the browser's stepMismatch constraint on decimal fields (integer fields can leave it unset).

`SectionProps` gained an optional `hidden?: boolean` field. A hidden section stays mounted instead of being unmounted, so wizard steps that navigate away keep their form state (and any extension section's submit registration) intact instead of losing it on remount.

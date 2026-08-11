---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

The auto-wired `entityEdit` path now has operable widgets for `multiSelect` (combobox), `decimal`/`bigInt` (number input), `tz` (IANA zone picker), and `longText` (always a textarea). `jsonb`, `embedded` (non-list), `files`, and `images` still render read-only — they stay unsupported on this path — but a statically `required: true` field of one of those types now throws a descriptive boot-time error instead of silently rendering an unfillable form.

---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix #1834: `embedded` (non-list), `jsonb` and `multiSelect` fields without a dedicated
widget no longer fall back to an editable text input — that fallback ran the value
through `stringValue()` and saving the form overwrote the real data with the mangled
string (`"[object Object]"`, `"a,b"`). They now render a read-only `Banner` instead.

`BannerProps` gained an optional `id` so `<Field>`'s `<label htmlFor>` has a real target
when it wraps a Banner instead of an input.

`required: true` on one of these fields is currently a dead end (no widget to satisfy
it) — the actual list/object editor is tracked separately in #1835.

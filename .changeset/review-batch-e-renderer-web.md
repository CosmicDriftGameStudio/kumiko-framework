---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fixes two rendering bugs surfaced in code review: `formatDatePlaceholder` now clamps a locale's year/month/day placeholder letters to their first code point before repeating them, so a missing i18n key falling back to its raw (multi-character) key string no longer produces a garbled date placeholder. Separately, `embedded-list-input`'s desktop table constrains a per-cell validation message's width instead of letting one long message force the whole table into horizontal scroll.

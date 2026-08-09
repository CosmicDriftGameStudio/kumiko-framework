---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix #1865: `DateField`'s placeholder now shows the localized format pattern
(`TT.MM.JJJJ` in de, `DD/MM/YYYY` in en) instead of a hardcoded example date
(`31.12.2026`). The example date read as an already-entered value once the
field lost focus, especially in forms where other fields were genuinely
prefilled.

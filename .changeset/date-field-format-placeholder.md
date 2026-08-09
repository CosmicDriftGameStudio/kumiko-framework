---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer": patch
---

DateField's placeholder now shows the locale's date format pattern (e.g. "TT.MM.JJJJ" in de, "MM/DD/YYYY" in en-US, "DD/MM/YYYY" in en-GB) instead of a hardcoded example date ("31.12.2026"), which read as an already-filled-in value and caused editors to skip the field. Fixes #1865.

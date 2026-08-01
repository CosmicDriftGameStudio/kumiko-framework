---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

`InfiniteSentinel`'s "— End of list —" marker now goes through `t("kumiko.list.end-of-list")` instead of a hardcoded English string, so it translates correctly in non-English apps (#1675).

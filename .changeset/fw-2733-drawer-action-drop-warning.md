---
"@cosmicdrift/kumiko-renderer": patch
---

fw#2733: a `kind: "drawer"` rowAction dropped by `buildProjectionRowActions` because the host did not wire `openDrawer` (e.g. `RelatedListSection` embedded without `onOpenDrawer`) now logs a one-time dev warning naming the action id, instead of silently vanishing. The action still does not render — only the previously missing signal was added.

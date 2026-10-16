---
"@cosmicdrift/kumiko-renderer-mail-html": patch
---

The in-code default mail layout places the body in `mj-text` instead of `mj-raw`. With `mj-raw` the body HTML landed directly in the column table, browsers moved it into the column wrapper with `font-size: 0`, and the mail body was invisible. Apps that seed the layout with `seedSystemMailLayout` get the fixed row on the next seed run.

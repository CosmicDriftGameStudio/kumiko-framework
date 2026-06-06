---
"@cosmicdrift/kumiko-renderer-web": patch
---

fix(pagination): `computeVisiblePages` keeps 5 page numbers visible at the list edges (sliding the window instead of clamping it) — e.g. `p=1/20` now shows `1 2 3 4 5 … 20` instead of `1 2 3 … 20`, matching the documented behaviour. Mid-list rendering is unchanged.

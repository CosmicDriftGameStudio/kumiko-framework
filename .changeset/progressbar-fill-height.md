---
"@cosmicdrift/kumiko-renderer-web": patch
---

`ProgressBar`'s fill bar no longer relies on `height: 100%` resolving against the wrapper's height, which silently rendered 0px tall whenever the surrounding layout stretched the wrapper instead of letting its own `h-2` apply. The wrapper is now `relative` and the fill is absolutely positioned with `inset-y-0`, so it always spans the wrapper's own box regardless of how the wrapper's height was determined.

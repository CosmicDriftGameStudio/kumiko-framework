---
"@cosmicdrift/kumiko-renderer-web": patch
---

`ProgressBar` now wraps its track in its own element, so the track's `h-2` height is never affected by padding or stretch a parent applies to its direct children. Previously the padding RenderEdit's wizard chrome applies to every direct child of the form body collided with `box-sizing: border-box` on the track itself, expanding it to ~36px instead of 8px — #1963 only fixed the fill bar's width resolving against that wrong height, not the height itself.

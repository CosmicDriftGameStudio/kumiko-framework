---
"@cosmicdrift/kumiko-headless": patch
---

`renderApexHeader` renders `<div class="container nav">`. `.container` sets horizontal padding via the `padding` shorthand, and `.nav` (same specificity, declared later) also used a `padding` shorthand — its `0` horizontal value won the cascade and clobbered the container's, so below the 1120px `.container` breakpoint the header lost its side padding (wordmark against the edge, CTA clipped). `.nav` now uses `padding-block` instead of `padding`, leaving `.container`'s horizontal padding untouched.

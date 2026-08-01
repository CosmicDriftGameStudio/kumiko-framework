---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`entityEdit`/`configEdit`/`actionForm`/`projectionDetail` screens can now set `layout.width` ("sm" | "3xl" | "4xl" | "full") to opt out of the hardcoded 3xl-centered form shell — useful for dense multi-column masks that previously left dead space on both sides (#1676). Unset stays "3xl" (unchanged default).

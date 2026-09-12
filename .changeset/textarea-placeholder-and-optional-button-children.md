---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`Input` gains `placeholder` for `kind="textarea"`, matching the hint-text behavior already present for `kind="text"` — a multiline field no longer loses its placeholder when it grows from single-line. `Button`'s `children` prop is now optional: an icon-only button (`size="icon"` with a resolved `icon`) no longer needs a dummy `children` value, since the icon plus `ariaLabel` already carry the button's content and accessible name.

---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

Both framework lightboxes can now page through several images. The React `Lightbox` primitive accepts `images`, `index` and `onIndexChange` as an alternative to `src`/`alt`, and the Apex marketing lightbox walks all `.shot-frame` screenshots on the page. Both wrap around at the ends and respond to the arrow keys.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Lightbox pages through multiple images
detail: |
  `LightboxProps` is now a union: the existing `src`/`alt` form is unchanged, and the new `images` + `index` + `onIndexChange` form renders previous/next buttons, a position counter and ArrowLeft/ArrowRight navigation with wrap-around when more than one image is given. The Apex lightbox collects every `.shot-frame img` on open and gains previous/next buttons; its CSP script hash changed. New i18n keys: `kumiko.lightbox.previous`, `kumiko.lightbox.next`, `kumiko.lightbox.position`.
-->

---
"@cosmicdrift/kumiko-bundled-features": minor
---

Render overlay layers (QR codes, badge images) onto image variants

The sharp renderer composites resolved overlay layers after resize and before final encoding. Overlay bytes go through the same SVG rejection as the source image, with DoS caps on layer count, size, and QR data length enforced in assertRenderSpecBounds.

<!-- kumiko-changes
feature: derivatives-sharp
type: improvement
title: Render overlay layers (QR codes, badge images) onto image variants
-->

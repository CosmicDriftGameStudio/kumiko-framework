---
"@cosmicdrift/kumiko-bundled-features": patch
---

The sharp renderer buffers intermediates losslessly before overlays and blur regions, so a JPEG source no longer gains an extra compression generation. QR overlays are generated at their final size and checked against the smaller of output width and height before generation, so a flat output can no longer cache an unscannable QR.

<!-- kumiko-changes
feature: derivatives-sharp
type: fix
title: Overlay and blur intermediates are lossless and QR overlays render crisp at their final size
-->

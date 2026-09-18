---
"@cosmicdrift/kumiko-bundled-features": minor
---

Add overlay stage (QR codes, badge images) to derived image variants

VariantSpec now supports declarative overlay layers (qr via a resolver-token, or a base64 image) composited onto derived image variants. QR values are never free text — only a dataToken resolved server-side via a new extension point, keeping the anonymous derivative route from becoming an open image generator.

<!-- kumiko-changes
feature: file-derivatives
type: improvement
title: Add overlay stage (QR codes, badge images) to derived image variants
-->

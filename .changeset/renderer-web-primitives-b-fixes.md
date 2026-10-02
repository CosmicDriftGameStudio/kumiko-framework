---
"@cosmicdrift/kumiko-renderer-web": patch
---

Secret reveal rows with equal labels get distinct React keys. A nested form's submit routing also covers `input[type=submit]` and `input[type=image]`. `Grid` ignores null and boolean children when computing `maxRows`, and its gap is the themeable `--kumiko-grid-gap` variable shared with the clip height. Card meta rows clip at the inline start so RTL layouts hide the leading separator too. The QR secret value imports `qrcode/lib/browser.js` so Metro does not pull Node-only dependencies.

<!-- kumiko-changes
feature: renderer
type: fix
title: Secret reveal keys, nested-form input submit routing, Grid maxRows/gap, RTL card meta, browser QR import
-->

---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

derivatives-sharp names the image types it can decode, and the renderer lookup honors that list.

<!-- kumiko-changes
feature: derivatives-sharp
type: fix
title: Variants of HEIC, HEIF and BMP files answer 415 or 404 instead of failing on every request
detail: derivatives-sharp registered its renderer for image/*, which also matched types the sharp build cannot decode. A variant request for such a file read the original and failed each time, with 500 on the signed-in route and 503 on the public route. It still registers image/*, but now lists the types it decodes (image/jpeg, image/jpg, image/png, image/webp, image/avif, image/gif and image/tiff) in the new optional field sourceMimeTypes of the DerivativeRendererPlugin. Other types such as HEIC, HEIF, BMP and SVG get no renderer, so the signed-in route answers 415 and the public route 404 before the original is read. An exact renderer registered by an app still wins over the wildcard, whatever the mount order. A wildcard renderer without sourceMimeTypes keeps applying to every type under it.
-->

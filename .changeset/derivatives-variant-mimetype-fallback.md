---
"@cosmicdrift/kumiko-framework": patch
---

Fixes a defense-in-depth gap in `ctx.derivatives.variant()`: a variant spec with no `format` fell back to the source FileRef's mimeType verbatim — client-controlled (`file.type` off the upload) on any field without an `accept` restriction. An app with a broad enough `derivativeRenderer` wildcard (e.g. `image/*`) could let a client's declared `image/svg+xml` (or similar active-content type) reach the variant response's `Content-Type` and stored provider metadata unchanged. `outputMimeType` now normalizes and allowlists the fallback against the framework's known-safe raster types (`image/jpeg`, `image/png`, `image/webp`, `image/avif`, `image/gif`) and returns `application/octet-stream` for anything outside that set.

This narrows behavior for a format-less variant whose source mimeType is outside that allowlist (e.g. `image/tiff`, `image/heic`): it now serves as `application/octet-stream` instead of that mimeType. If a deployment relies on such a type staying inline-renderable, set `spec.format` explicitly on the variant.

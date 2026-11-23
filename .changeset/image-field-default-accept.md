---
"@cosmicdrift/kumiko-framework": minor
---

Image fields without `accept` take only raster formats.

<!-- kumiko-changes
feature: framework
type: breaking
title: Image fields without accept take only jpg, jpeg, png, gif, webp, avif, heic and heif
detail: createImageField and createImagesField without accept used to take every file. New uploads and pending uploads bound to such a field are now checked against jpg, jpeg, png, gif, webp, avif, heic and heif, and the file picker offers the same list. Files a record already holds are untouched, and moving a stored file with rebindFileRef still checks only an explicit accept.
migration: Image fields that should take SVG, PDF, BMP or TIFF need an explicit accept; accept [] allows everything.
affects: createImageField, createImagesField, accept
-->

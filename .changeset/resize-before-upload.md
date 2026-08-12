---
"@cosmicdrift/kumiko-renderer-web": patch
---

`UploadZone` and `FileUploadInput` downscale images to a 2560px max edge before upload (bandwidth), which also strips EXIF/GPS as a side effect of the canvas re-encode. SVG and GIF pass through unchanged (vector/animation would be destroyed); browsers without `OffscreenCanvas` fall back to uploading the original file unchanged.

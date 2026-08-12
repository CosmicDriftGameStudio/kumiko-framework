---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Image fields declare named derived versions: `createImageField({ variants: { profile: { fit: "cover", size: { width: 512, height: 512 }, format: "webp" } } })`. The specs are boot-validated, and `GET /api/files/:id/variant/:name` serves them behind the same tenant + access guard as the download — a request carries only a NAME, never a spec, so no caller can drive an arbitrary render. The edit-form preview loads the first declared variant instead of the original.

BREAKING: `ImageFieldDef.thumbnails` / `ImagesFieldDef.thumbnails` are removed. The flag was never read by anything; `variants` is what it pointed at.

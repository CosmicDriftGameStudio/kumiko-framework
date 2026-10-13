---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

A stored file or image in a file field has an open link, and a disabled file input cannot remove its value. The web file input links a saved `file` to `/api/files/<id>` in a new tab, labelled with the file name from `/api/files/<id>/meta` or "Open file" until the name loads or when it cannot be read; an `image` preview links to the original. Read-only file fields rendered as text (`valueDisplay="text"`) show links ("Open file" for one file, "File 1", "File 2" for plural fields) instead of the raw file ids. The "Remove" button is hidden while the input is disabled.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: File input links the stored file and respects disabled
detail: FileUploadInput kind file shows a link to /api/files/<id> (target _blank, rel noopener noreferrer) labelled with the fileName from /api/files/<id>/meta, falling back to kumiko.field.file-upload.open; the image preview links to the original. The Remove button is no longer rendered when disabled is true, so a read-only FileListField offers no remove, reorder or add.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Read-only file fields show open links instead of file ids
detail: RenderField with valueDisplay text renders file and image values as a Link primitive to /api/files/<id> labelled kumiko.field.file-upload.open, and files/images values as one link per file labelled kumiko.field.file-list.item ("File 1", ...). The raw UUIDs are no longer shown. New keys: kumiko.field.file-upload.open, kumiko.field.file-list.item.
-->

<!-- kumiko-changes
feature: locale-de
type: improvement
title: German strings for the file open link
detail: Adds kumiko.field.file-upload.open and kumiko.field.file-list.item.
-->

<!-- kumiko-changes
feature: locale-es
type: improvement
title: Spanish strings for the file open link
detail: Adds kumiko.field.file-upload.open and kumiko.field.file-list.item.
-->

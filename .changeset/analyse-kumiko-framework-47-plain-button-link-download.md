---
"@cosmicdrift/kumiko-renderer": patch
---

Button gets a plain variant for clickable rows and tiles, Link a download option, and FilePickButton picks files without uploading them.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Plain button variant, Link download and FilePickButton
detail: `<Button variant="plain">` renders a button without the fixed height, padding, centring and background of the other variants and keeps the focus ring and the disabled state, so a multi-line row or an image thumbnail can be the click target; `width="full"` stretches it. `<Link download="name.png">` saves the target as a file and then also accepts `blob:` and `data:image/` hrefs, which a plain link still blocks. `FilePickButton` from `@cosmicdrift/kumiko-renderer/web` is a Button that opens the file picker and hands the picked files to `onFilesPicked` without uploading them (`accept`, `multiple`, `capture`). Apps can replace their raw `<button>`, `<a download>` and hidden `<input type="file">` exceptions for these cases.
-->

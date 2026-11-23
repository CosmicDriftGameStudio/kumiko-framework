---
"@cosmicdrift/kumiko-framework": patch
---

The declared type of an upload is checked against its bytes for png, jpeg, gif, webp, tiff and pdf.

<!-- kumiko-changes
feature: framework
type: fix
title: The declared type of an upload is verified against its bytes
detail: For png, jpeg, gif, webp, tiff and pdf the declared type is checked against the bytes. Unknown content is stored as application/octet-stream (this includes a PDF with bytes in front of its header when the name has no extension), a contradicting known type is normalized to the sniffed type, or rejected when the field's accept has no matching extension. A declared type that has no signature check (for example image/svg+xml on a file named .heic) is stored as application/octet-stream when the field's accept lists none of its extensions. Names without an extension get a .bin storage key instead of the whole name as extension, and TIFF is recognized by its signature.
-->

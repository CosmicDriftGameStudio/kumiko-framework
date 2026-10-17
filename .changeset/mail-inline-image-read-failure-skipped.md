---
"@cosmicdrift/kumiko-bundled-features": patch
---

A mail without a readable inline image is sent without it

<!-- kumiko-changes
feature: delivery
type: fix
title: A mail without a readable inline image is sent without it
detail: An inline image whose bytes could not be read (for example a system template logo while the job context has no provider resolver) failed the whole mail send. The attachment reader now logs a warning with the fileRef id and skips the image.
-->

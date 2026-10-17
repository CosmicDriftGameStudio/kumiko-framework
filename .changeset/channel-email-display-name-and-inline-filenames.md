---
"@cosmicdrift/kumiko-bundled-features": patch
---

SMTP display names drop address-like characters, inline images get matching extensions

<!-- kumiko-changes
feature: channel-email
type: fix
title: SMTP display names drop address-like characters, inline images get matching extensions
detail: Control characters, angle brackets and at signs in a From display name are replaced by spaces so it cannot smuggle a second address; inline image file names derive their extension from the shared image format list.
-->

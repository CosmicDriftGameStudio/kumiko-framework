---
"@cosmicdrift/kumiko-bundled-features": patch
---

Template layout usage uses effective rows

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Layout usage follows the effective template per notification and locale
detail: Mail layout usage counts a notification only when it declares a template and resolves the effective row per notification and locale, so tenant overrides are reflected.
-->

---
"@cosmicdrift/kumiko-bundled-features": patch
---

Document editor no longer blanks the app when late placeholders rebuild it

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Document editor no longer blanks the app when late placeholders rebuild it
detail: When the system placeholders or resource previews arrived in the same render as a new value (layout editor after opening or saving), the editor rebuilt itself and the value sync then read the destroyed editor. The TypeError unmounted the whole app and left a blank page. Both sync effects now skip a destroyed editor; the replacement editor picks up the value on its next render.
-->

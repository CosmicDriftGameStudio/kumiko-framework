---
"@cosmicdrift/kumiko-bundled-features": patch
---

The privacy-center screen's "restrict" action declares an explicit icon

The boot validator now requires every projectionDetail action to resolve an icon (fw#3234); "restrict" resolved none from the shared id-derived map, so it now declares `icon: "lock"` explicitly. "request-deletion" needed no change — it now resolves via the shared map's new `deletion: "trash"` entry (@cosmicdrift/kumiko-types).

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: The privacy-center screen's "restrict" action declares an explicit icon
-->

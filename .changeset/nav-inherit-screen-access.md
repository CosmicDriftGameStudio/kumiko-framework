---
"@cosmicdrift/kumiko-renderer-web": patch
---

Nav entries without their own `access` now inherit the access rule from
their referenced screen (`buildNavRegistrySliceForApp`). Previously a nav
entry with no explicit `access` was always visible once its workspace
granted access, even when the target screen's own `access` was narrower —
a role could see the entry, click it, and get a 403 instead of the entry
being hidden. An explicit `access` on the nav entry still wins over the
screen's. Fixes #1099.

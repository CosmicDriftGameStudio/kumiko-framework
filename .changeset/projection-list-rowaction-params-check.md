---
"@cosmicdrift/kumiko-framework": patch
---

Boot-validator now catches `projectionList` navigate rowActions that set `params` on a target screen that would silently ignore them (same check `entityList` already had — #1680). A rowAction that resolves to entityEdit-update mode, or targets a screen type other than actionForm/entityEdit-create, now fails boot with a clear message instead of the params silently no-oping at runtime.

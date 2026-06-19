---
"@cosmicdrift/kumiko-bundled-features": minor
---

tags: ship a drop-in web UI. New client subpath `@cosmicdrift/kumiko-bundled-features/tags/web` exports `<TagSection entityName entityId />` (a self-contained tag manager: shows an entity's tags, attach existing / create-and-attach / detach, all via the existing tag handlers) plus `tagsClient()` to register it (component + default i18n). Mount standalone in any screen, or as a `kind: "extension"` section. Server feature unchanged — purely additive client code.

---
"@cosmicdrift/kumiko-renderer": minor
---

Extension sections that save host form values themselves can now mark the host form as saved, so the leave guard no longer asks to discard after a successful write.

<!-- kumiko-changes
feature: renderer
type: improvement
title: ExtensionSectionProps.markSaved marks host form values as saved
detail: ExtensionSectionProps gains an optional markSaved callback, set in entityEdit sections and the entityEdit footer slot. An extension section that writes the host entity's values through its own command calls it after the write succeeds; the host form then counts as clean and a following navigation passes the leave guard without the discard dialog. Additive API.
migration: None. Additive API.
-->

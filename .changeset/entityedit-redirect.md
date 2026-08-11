---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

`entityEdit` screens now support `redirect?: string`, mirroring `actionForm`'s field: navigate to this same-feature screen ID after a successful save (create or update) instead of the default "back to the entity's list" target. Boot-validator checks the ID resolves to a registered screen, same as `actionForm.redirect`. Delete is unaffected — it still always navigates to the list.

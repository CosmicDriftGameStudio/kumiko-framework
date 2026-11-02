---
"@cosmicdrift/kumiko-renderer": patch
---

Create forms no longer block a required field that has an entity default.

<!-- kumiko-changes
feature: renderer
type: fix
title: Required fields with an entity default no longer block create forms
detail: The field-derived required check added for `RenderEdit` flagged an empty required field in create mode even when the entity declares a `default`, which the server applies on insert. Create mode now skips the presence check for such fields; update mode is unchanged.
-->

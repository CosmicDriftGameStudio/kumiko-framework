---
"@cosmicdrift/kumiko-bundled-features": patch
---

`tag:delete` no longer detaches a tag from records the caller cannot see.

<!-- kumiko-changes
feature: tags
type: fix
title: tag:delete refuses while a hidden record carries the tag
detail: The tag:delete cascade listed and removed every assignment of the tag without the caller's read gate, so in an app with team-scoped records any member could delete a tag and strip it from the records of other teams, with no way to restore the assignments. tag:delete now answers 422 with reason `tag_in_use_on_hidden_records` while an assignment the caller cannot read still points at a live record, and removes nothing. Assignments on deleted records are still removed together with the tag, and a caller who can read every carrying record deletes as before. Who may create, rename or delete tags is unchanged.
-->

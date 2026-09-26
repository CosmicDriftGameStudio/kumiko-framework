---
"@cosmicdrift/kumiko-framework": patch
---

`parseChangesetChanges` no longer breaks on a blank line inside a `key: |` block

<!-- kumiko-changes
feature: framework
type: fix
title: Changeset block parser keeps blank lines inside a multiline field
detail: |
  A blank line inside a `detail:`/`migration:` `|` block ended the
  continuation early because the check only looked for a leading two-space
  indent. The next indented line then no longer matched `key: value` on its
  own and parseChangesetChanges threw "invalid kumiko-changes line" instead
  of the real cause. Blank lines inside the block are now kept as paragraph
  breaks in the field value.
-->

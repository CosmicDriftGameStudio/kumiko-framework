---
"@cosmicdrift/kumiko-framework": minor
---

Field-level access.read with a where-rule now fails the boot (also on embedded sub-fields)

<!-- kumiko-changes
feature: framework
type: breaking
title: Field-level access.read with a where-rule now fails the boot (also on embedded sub-fields)
migration: |
  Replace the where-rule on the field with a from()-rule (e.g. from("user:id", "ownerId")) or move the where-rule to entity access.read. Field read access is evaluated in memory and could never grant a where-rule, so it only hid the field.
-->

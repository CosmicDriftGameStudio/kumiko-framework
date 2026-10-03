---
"@cosmicdrift/kumiko-framework": patch
---

Boot validation rejects a text field that is `searchable` (or `find: "fuzzy"`) and also has a restricted `access.read`. The search index is not filtered per role, so search matches leaked the value to roles that cannot read the field.

<!-- kumiko-changes
feature: boot-validator
type: security
title: searchable text fields must not declare a restricted access.read
migration: |
  Remove `searchable` / `find: "fuzzy"` from the field, or remove the read restriction. Write-only `access.write` restrictions are unaffected.
-->

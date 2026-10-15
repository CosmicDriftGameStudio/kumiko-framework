---
"@cosmicdrift/kumiko-framework": minor
---

Optional number fields in entity forms start empty instead of 0

<!-- kumiko-changes
feature: framework
type: breaking
title: Optional number fields in entity forms start empty instead of 0
migration: |
  An optional number field without default no longer starts at 0 in entityEdit create/edit, and an untouched one is not sent. If a screen relied on the implicit 0, declare default: 0 on the field.
-->

---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Edit and detail screens show a localized empty state with a way back to the list for an unknown or deleted record id instead of a hard-coded English banner, and an entity list or detail no longer fails with a 500 when one row's encrypted field cannot be decrypted: that field reads null, the rest of the row and list are served, and the failure is logged at error level with entity, row id and field

<!-- kumiko-changes
feature: framework
type: fix
title: Unknown record ids show a localized empty state; an undecryptable encrypted field reads null instead of failing the whole list
-->

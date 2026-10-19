---
"@cosmicdrift/kumiko-framework": patch
---

A save cannot name a file that is bound to another record

<!-- kumiko-changes
feature: framework
type: fix
title: A save cannot reference a file that belongs to another record
detail: Creating or updating a record with a file id that is already bound to a different record of the same tenant is now rejected with invalid_element on that field, the same error as for a foreign tenant. Pending uploads, ids the record already holds and moves between its own file fields are unaffected.
-->

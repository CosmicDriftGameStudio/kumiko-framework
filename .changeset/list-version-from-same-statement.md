---
"@cosmicdrift/kumiko-framework": patch
---

list() reads rows and stream versions in one statement

<!-- kumiko-changes
feature: framework
type: fix
title: list() reads rows and stream versions in one statement
detail: The entity list read the rows first and the stream versions in a second statement, so a concurrent write could pair old row data with a newer version, and an update built on that version would pass the optimistic lock. The stream version is now a correlated subquery of the list statement, the same way detail() reads it.
-->

---
"@cosmicdrift/kumiko-renderer": patch
---

projectionDetail shows the record again after a record action

<!-- kumiko-changes
feature: renderer
type: fix
title: projectionDetail shows the record again after a record action
detail: After a writeHandler action on a projectionDetail (header or section action) the screen refetched the record but the shown fields kept their old values until a reload. The actions now reload through the same path as the reload button, which re-applies the refetched record to a form without user input.
migration: None.
-->

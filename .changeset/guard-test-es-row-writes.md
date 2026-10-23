---
"@cosmicdrift/kumiko-guards": minor
---

New guard that stops framework tests from writing event-sourced rows through updateRows and deleteRows.

<!-- kumiko-changes
feature: guards
type: improvement
title: Guard against projection-only writes in framework tests
detail: The Test-ES-Row-Writes guard flags updateRows and deleteRows from the testing helpers in framework tests, because they change the projection but not the event log. It only runs in the framework repo; consumer repos are not affected.
-->

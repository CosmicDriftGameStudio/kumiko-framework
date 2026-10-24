---
"@cosmicdrift/kumiko-bundled-features": patch
---

A workflow run woken by its awaited event resumes on the next tick even when the app clock runs ahead of the database clock.

<!-- kumiko-changes
feature: workflow-runner
type: fix
title: Woken workflow runs are due on the next resume tick
detail: The event subscriber stamped wakeAt with the app clock, while the resume job selects due rows with the database clock. With an app clock ahead of the database, a woken row was not due yet and waited for a later tick. wakeAt is now set with the database clock, like the due-runs query.
-->

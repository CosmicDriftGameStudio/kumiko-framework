---
"@cosmicdrift/kumiko-bundled-features": patch
---

A regression test pins that a woken workflow run is due on the next resume tick even when the app clock runs ahead of the database clock.

<!-- kumiko-changes
feature: workflow-runner
type: improvement
title: Regression test for the woken-run due check
detail: The event-wakeup integration test now runs the wakeup with the app clock one hour ahead of the database and expects resume-due-runs to complete the run. Nothing changes for apps; the package is only republished.
-->

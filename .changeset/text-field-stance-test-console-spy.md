---
"@cosmicdrift/kumiko-guards": patch
---

The text-field-stance guard test only counts the guard's own warnings, so unrelated async warnings from other test files in the same run no longer fail it.

<!-- kumiko-changes
feature: guards
type: fix
title: text-field-stance guard test no longer fails on unrelated warnings in a shared test run
detail: The test spied on console.warn globally and asserted zero calls. In a run that shares one process across test files, async warnings from other files (job-runner stop, mail egress) landed in the spy and turned main red. The assertion now only counts calls with the guard's own warn prefix. No change to the guard itself.
-->

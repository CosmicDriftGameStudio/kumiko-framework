---
"@cosmicdrift/kumiko-guards": patch
---

The doc-status guard warns about active plans that nobody has re-verified for over 90 days.

<!-- kumiko-changes
feature: guards
type: improvement
title: doc-status warns about stale active plans
detail: A status doc with `status: in-progress` or `blocked` whose `verified` date is more than 90 days old now gets the warning "last verified <date>, over 90 days ago: re-verify it or archive it". It is a warning, not a violation. `statusDocHygieneWarnings` takes the current date as a second argument.
-->

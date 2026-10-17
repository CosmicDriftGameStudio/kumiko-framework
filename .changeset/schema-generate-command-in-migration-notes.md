---
"@cosmicdrift/kumiko-bundled-features": patch
---

Name the real schema command for older migration notes

<!-- kumiko-changes
feature: jobs
type: fix
title: Older migration notes that say "kumiko migrate generate" mean kumiko-schema generate
detail: Migration notes of the delivery, jobs, metrics and sessions features name a command that does not exist, `kumiko migrate generate`. Run `kumiko-schema generate <name>` and then `kumiko-schema apply` instead. The published notes stay as they were.
-->

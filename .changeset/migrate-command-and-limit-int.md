---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Migration hints name the real `kumiko-schema generate` command, and the jobs list queries reject fractional `limit` values

The generated migration header and the recipe READMEs pointed at a non-existent `kumiko migrate generate`. `jobs:query:list` and `jobs:query:failures` now validate `limit` as an integer (at least 1), so `limit: 2.5` fails validation instead of reaching the database query.

<!-- kumiko-changes
feature: jobs
type: fix
title: jobs:query:list and jobs:query:failures reject a fractional limit, and migration hints name `kumiko-schema generate`
-->

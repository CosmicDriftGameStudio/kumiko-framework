---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The framework `jobs` entry now exports `serializeJobSubject`, the single source of the tenant-visible failure subject string. The job runner and `jobs:query:failures` both use it, so the subject filter cannot drift from what the runner stored.

<!-- kumiko-changes
feature: jobs
type: fix
title: Tenant failure subject filter shares one serializer with the job runner
-->

---
"@cosmicdrift/kumiko-framework": patch
---

Section readers see groups[].fields

Boot-guard and E2E-generator now flatten section.groups via sectionFieldSpecs instead of iterating section.fields only: a function renderer inside groups[].fields fails at boot, and generated E2E specs cover group fields (required fields, fill ops, text assertions).

<!-- kumiko-changes
feature: framework
type: fix
title: Section readers see groups[].fields
-->

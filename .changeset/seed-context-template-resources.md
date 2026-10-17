---
"@cosmicdrift/kumiko-framework": patch
---

Seed context finds template resources again

<!-- kumiko-changes
feature: framework
type: fix
title: Seed context finds template resources again
detail: findTemplateResources in the seed context filtered on an is_deleted column that the template resource table does not have, so every seed that read template resources failed. The query now reads the live rows only.
-->

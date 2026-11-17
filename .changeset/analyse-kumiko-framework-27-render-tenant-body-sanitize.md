---
"@cosmicdrift/kumiko-bundled-features": patch
---

Stored tenant mail and PDF bodies are re-checked by the document sanitizer at render time and fall back to the system template when they fail.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Tenant mail and PDF bodies are re-sanitized at render time
detail: Tenant layouts were re-checked on every render, tenant template bodies were not, so a row stored before the write gate existed or through another path (import, seed, migration) could put an iframe, form or tracking image into a mail or PDF. Mail and PDF rendering now run a stored tenant body through the same sanitizer as the write gate (cached per template version) and render the system template of the same slug when it fails, as layouts already do. `revalidateStoredTemplateBody` is exported from the template-resolver entry point.
-->

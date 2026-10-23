---
"@cosmicdrift/kumiko-document-designer": patch
---

The PDF template editor only uses a template detail whose id matches the row picked for the current scope and locale.

<!-- kumiko-changes
feature: document-designer
type: fix
title: The PDF editor no longer saves or publishes the previous row after a scope switch
detail: When the host scope changed while the editor was open, for example once the SystemAdmin role loaded, the editor kept showing the tenant copy until the system row arrived. Save then wrote the tenant content as the system template, and publish sent the tenant row to publishSystem. The editor now shows the loading state until the detail of the newly picked row has loaded.
-->

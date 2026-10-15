---
"@cosmicdrift/kumiko-server-runtime": minor
---

runProdApp wires the tenant config accessor into the inline delivery path

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Immediate notify renders with the tenant config in runProdApp
detail: The boot delivery notify factory passes tenantConfigFor, built from the boot config resolver, to the delivery service, so immediate notifications render the tenant name in the mail layout like the delivery.render job does.
-->

---
"@cosmicdrift/kumiko-bundled-features": minor
---

Inline delivery path passes the tenant config accessor

<!-- kumiko-changes
feature: delivery
type: breaking
title: NotificationRenderer and RendererInput removed, immediate notify renders with the tenant config
detail: The inline (immediate, job-less) delivery path now gets the tenant config accessor like the delivery.render job, so the mail layout shows the tenant name in both paths. DeliveryServiceOptions and CreateDeliveryTestContextOptions accept tenantConfigFor; runProdApp wires it from the boot config resolver. The types NotificationRenderer and RendererInput are removed from the delivery exports because the legacy renderer path is gone.
migration: |
  Drop NotificationRenderer and RendererInput imports; render mails with template + meta on r.notification (see renderer-foundation).
-->

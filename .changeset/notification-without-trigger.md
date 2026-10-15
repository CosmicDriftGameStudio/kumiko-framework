---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

r.notification without trigger, localizedTemplate and mail locale helpers

<!-- kumiko-changes
feature: framework
type: improvement
title: r.notification works without trigger and ships localized templates
detail: trigger, recipient and data are optional and must be declared together, a notification without trigger is sent explicitly through ctx.notify. localizedTemplate groups body and meta per locale and is mutually exclusive with template and meta. The variable names link, money and date are reserved for template helpers. ctx.notify validates the data against the declared variables and fails the write on a missing required variable. New exports are listMailLocales, hasMailTranslationKey, assertNotificationVariables and NotificationLocalizedTemplate.
-->

---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Only notifications marked tenantTransport go through the tenant's own mail provider

<!-- kumiko-changes
feature: channel-email
type: breaking
title: The tenant mail transport applies per notification
detail: r.notification(name, { tenantTransport: true }) marks a notification whose mails go through the tenant's own mail transport. channel-email consults its tenantTransport resolver only for these (also under a renamedFrom name); every other notification, such as password reset or sign-in mails, always takes the app transport, even when the tenant has a provider. With tenantTransport set, transport may be omitted: a mail that then has no transport fails with missing_credentials instead of throwing. The template test mail (template-resolver send-test) now gets the tenant config in its channel context and uses the template's notification, so it leaves through the same transport as the real mail.
migration: Apps that pass tenantTransport to createChannelEmailFeature add `tenantTransport: true` to every r.notification whose mails should go through the tenant's provider; without the flag those mails now go through the app transport. Apps without an app SMTP server can drop transport and keep tenantTransport.
-->

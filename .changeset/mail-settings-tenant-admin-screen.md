---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

Tenant admins edit their own mail server in the settings

<!-- kumiko-changes
feature: mail-transport-smtp
type: breaking
title: Tenant admins edit their own SMTP server on the Email sending screen
detail: mail-foundation's provider key and the SMTP keys (host, port, SSL/TLS, user name, sender address) carry settings masks, so the generated Settings-Hub shows tenant admins one Email sending screen with the provider choice, the SMTP connection and the SMTP password, each field with a help text and every label in English, German and Spanish. The provider key is no longer required: empty means the tenant has no own server and the platform sends, so readiness no longer reports it as missing (createTransportForTenant still throws on an empty provider). The provider and SMTP keys are written by TenantAdmin and the system identity, no longer by SystemAdmin, because a platform-level provider would reach every tenant without that tenant's password. The secrets set and delete handlers also admit the system identity, so server code stores a tenant secret via dispatchSystemWrite through the same key and value checks as an admin; the settings screens keep showing only the human roles. The provider choice shows each plugin's `<feature>.settings` name for every selectable plugin, also one without settings of its own (the in-memory transport is now "Test inbox (in memory)"), and keeps the English name when a locale feature mounted earlier declares the same key in its own language only. A plugin's secrets section takes an optional `<feature>.settings.secrets` title, so the SMTP password sits under "SMTP sign-in" instead of a second "SMTP server" heading.
migration: Code that wrote these keys as a SystemAdmin user writes them as the tenant's TenantAdmin or via dispatchSystemWrite. Apps that relied on readiness flagging an empty provider check it themselves.
-->

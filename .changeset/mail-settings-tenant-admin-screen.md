---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

Tenant admins edit their own mail server in the settings

<!-- kumiko-changes
feature: mail-transport-smtp
type: breaking
title: Tenant admins edit their own SMTP server on the Email sending screen
detail: mail-foundation's provider key and the SMTP keys (host, port, SSL/TLS, user name, sender address) carry settings masks, so the generated Settings-Hub shows tenant admins one Email sending form: the provider choice, the chosen provider's connection fields and its password, each field with a help text and every label in English, German and Spanish, saved together by one Save button in one /api/batch. Switching the provider swaps the fields at once; fields of a provider that is not selected are not saved. A selector owner's selection screen (`<owner>-tenant-selection`) now carries the plugins' config keys (field id `<owner>-<key>`) and secrets (field id `<plugin>-<key>`, listed in the new ConfigEditScreenDefinition.secretKeys) behind a visible condition on the provider field; the separate `<plugin>-tenant` and `<plugin>-tenant-secrets` screens and their dashboard panels are gone, and so is the `config.settings.saveProvider` label. A secret with its own writeRoles stays on the global secrets screen. Boot validation checks every secretKeys field (tenant scope, writeOnly text, declared secret). The configEdit renderer loads secretKeys fields from secrets:query:list (set or unset, no preview), writes them with secrets:write:set or secrets:write:delete in the same batch, and leaves hidden fields out. The provider key is no longer required: empty means the tenant has no own server and the platform sends, so readiness no longer reports it as missing (createTransportForTenant still throws on an empty provider). The provider and SMTP keys are written by TenantAdmin and the system identity, no longer by SystemAdmin, because a platform-level provider would reach every tenant without that tenant's password. The secrets set and delete handlers also admit the system identity, so server code stores a tenant secret via dispatchSystemWrite through the same key and value checks as an admin; the settings screens keep showing only the human roles. The provider choice shows each plugin's `<feature>.settings` name, also for a plugin without settings of its own, and keeps the English name when a locale feature mounted earlier declares the same key in its own language only. A MailTransportPlugin with `selectableInSettings: false` stays allowed on the server but is not offered in the form; the in-memory transport sets it, because apps mount it next to smtp in production and a tenant admin picking it would drop every mail. A plugin's secrets section takes an optional `<feature>.settings.secrets` title (SMTP password under "SMTP sign-in").
migration: E2E specs that used the testIds `dashboard-panel-<plugin>-tenant`, `dashboard-panel-<plugin>-tenant-secrets` or the separate secret input of these screens address the fields of `<owner>-tenant-selection` instead (one Save). Code that wrote these keys as a SystemAdmin user writes them as the tenant's TenantAdmin or via dispatchSystemWrite. Apps that relied on readiness flagging an empty provider check it themselves.
-->

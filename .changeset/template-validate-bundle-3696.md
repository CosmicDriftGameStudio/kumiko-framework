---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

Template validation query, layout kinds as structured html, bundle import/export, copy-locale and notification record mapping

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: Tenant mail-layouts are structured html, pdf-layout and document-pdf are placeholder-validated
detail: A new validate query dry-runs the write pipeline (used, unknown and missing placeholders, canSave, canPublish). document-pdf, pdf-layout and mail-layout now go through the same placeholder gate as mail; document-pdf and pdf-layout know the system placeholders page and pages. A tenant mail-layout is html with a data-content slot plus header, signature and footer regions that renderer-mail-html wraps in a fixed MJML frame; raw mjml (with {{{content}}} exactly once) is system-only. New handlers export-bundle, import-bundle, import-bundle-system and copy-locale move a template with its resource files between tenants and locales. r.notification accepts a record mapping from an entity row to the declared variables, validated at boot. publish and archive no longer touch system rows through a tenant-scoped SystemAdmin.
migration: |
  Tenant mail-layout rows stored as mjml are ignored by the renderer, which falls back to the system layout; re-create them as html with a data-content slot. upsert-system answers with an extra validation field. seedSystemTemplate errors now read `<label> rejected: <code> (<detail>); ...`. Layout bodies without the content slot are rejected on write. `set` now runs the same gate for mail, document-pdf, pdf-layout and mail-layout rows and rejects unsanitized markup or publish issues, since saving publishes; the mail renderer also re-sanitizes stored tenant html layouts and falls back to the system layout when they fail. upsert-system and upsert-tenant no longer accept linkedResources (resources go through the resource upload; bundle import and copy-locale attach them). Unknown data-resource keys are a validate warning (resource_not_uploaded), not a write error.
-->

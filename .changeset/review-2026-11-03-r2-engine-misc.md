---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Review round 2, engine misc: wire-name collisions are checked only for events released through PAT scopes, XLSX export is rate limited, isolated e2e specs keep their project's settings, the unsubscribe page shows the uploaded logo, mail and PDF templates reject relative links, api-docs reports missing title and field-label translations, and documents are created by admin roles only by default.

<!-- kumiko-changes
feature: framework
type: fix
title: review round 2 engine fixes (wire names, export rate limit, isolated e2e, mail logo, relative links, api-docs, documents)
detail: Two unreleased webhook events with the same default wire name no longer fail boot; `personal-access-tokens/released-wire-name-collision` rejects it only when both are released through PAT scopes. `createExportRoutes` takes an optional rate limit resolver (60 per minute per user). `isolatedSpecs` builds one serial twin per project with its own `use`, and rejects projects with their own `testMatch`. The unsubscribe page chrome inlines the uploaded branding logo as a raster data URI. Mail and PDF template bodies with a relative link are rejected on save (`relative_link_without_base`); snippets and managed pages keep them. api-docs reports `titleTranslationMissing` and `fieldLabelMissing` per non-en locale. `documents:write:filed-document:create` defaults to the admin roles when no `access` option is given.
-->

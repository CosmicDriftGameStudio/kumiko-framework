---
"@cosmicdrift/kumiko-bundled-features": minor
---

A tenant override of a template is delivered only while the template is unlocked via tenantEditable; createTemplateResolverApi now takes the registry; user-data-rights env docs corrected.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: Overrides of locked templates are no longer served
detail: A tenant override of a mail, PDF or layout template is delivered (mail send, PDF render, linked PDFs, layouts, previews, export bundles, document blocks, overview, text blocks) only while the template is listed in tenantEditable. A locked override stays stored and has no effect; listing the template makes it effective again, nothing is deleted. A SystemAdmin sees locked overrides in the overview (`lockedOverride`, `lockedOverrideI18nKey`) and can reset or archive them with the existing handlers; the template-resolver queries do not show them to a TenantAdmin; the audit log keeps the history. Tenant rows of a collection mounted with `access` are always served. createTemplateResolverApi(db) became createTemplateResolverApi(db, registry) because the delivery policy is read from the mounted feature; without the mounted feature no tenant override is served.
migration: Overrides of templates that are not tenantEditable are no longer served; enable the template via tenantEditable to keep using them. Pass the registry as second argument to createTemplateResolverApi (ctx.registry in handlers, stack.registry in tests). Tenant rows without a system counterpart (for example text blocks seeded directly into a tenant) are hidden as well unless listed in tenantEditable.
-->

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: DELETION_TOKEN_SECRET description corrected
detail: The env description no longer claims a fallback to JWT_SECRET; without the secret the anonymous deletion-confirmation flow stays off.
-->

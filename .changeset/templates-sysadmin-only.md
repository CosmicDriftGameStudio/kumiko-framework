---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Only the SystemAdmin edits templates by default. An app unlocks TenantAdmins per kind and slug with `createTemplateResolverFeature({ tenantEditable: [{ kind, slug, access }] })`; reading and delivery are unchanged. Template collections without an `access` rule are SystemAdmin-only. The document designer takes `createDocumentDesignerFeature({ access })` for its editor screens, and `composeRendererStack` passes `templateResolver` options through.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: Template editing is SystemAdmin-only unless the app unlocks it
detail: Every tenant write handler, the overview and resource upload accept SystemAdmin only, plus the roles of the tenantEditable entries. A write on a template that is not unlocked fails with templateNotTenantEditable. The test send follows the same rule. For a non-SystemAdmin an unknown template id answers 403 like a locked one, so the response does not reveal whether it exists. Collections without an access rule default to SystemAdmin.
migration: Where TenantAdmins must keep editing a template, pass tenantEditable to createTemplateResolverFeature, for example tenantEditable: [{ kind: "mail", slug: "billing:notify:invoice-issued", access: { roles: ["TenantAdmin"] } }]. Give template collections an explicit access rule if tenants should manage them.
-->

<!-- kumiko-changes
feature: document-designer
type: breaking
title: Designer screens are SystemAdmin-only unless the app passes access
detail: The templates screen, layout, PDF and mail editors are visible to SystemAdmin only by default. createDocumentDesignerFeature takes an optional access rule whose roles are added.
migration: Pass createDocumentDesignerFeature({ access: templateEditAccess(tenantEditable) }) with the same entries given to the template resolver when TenantAdmins edit templates.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: composeRendererStack forwards templateResolver options
detail: RendererStackOptions.templateResolver is passed to createTemplateResolverFeature, so an app can set tenantEditable.
-->

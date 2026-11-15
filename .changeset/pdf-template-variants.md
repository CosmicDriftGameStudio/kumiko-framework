---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
---

A PDF document template can have variants: several versions of the same document (for example a rental contract for residential, commercial or garage use) that share the variables of one base template. The app allows them per template with `variants: true` on its `tenantEditable` entry; a tenant creates its own with `create-variant`, and the consumer lists them with the `variants` query and renders the chosen one with `variant`.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Variants of a PDF template
detail: A `tenantEditable` entry of kind `document-pdf` accepts `variants: true` (any other kind fails boot with `template-resolver/tenant-editable-variants-need-pdf`). A variant is a `document-pdf` row with the slug `<base>:<name>` (name: one kebab segment, at most 40 characters) and `meta.variantOf = <base>`; its title is the title column. The new write `template-resolver:write:create-variant` ({baseSlug, title, name?, locale?}; `name` is derived from the title when omitted, `locale` defaults to `de`) copies the base as the caller's tenant draft with the base's content, variables, linked images and settings, and is refused with `variants_not_enabled` when the base entry lacks `variants: true` (also for a TenantAdmin) and with `variant_exists` for a taken slug. A variant's `variableSchema` follows its base: every write without an explicit schema (`patch-draft`, `create-variant`, publish) stores the base's current effective schema, so a base that gains a variable does not lock its variants and publish gates the required placeholders against it. `setVariable` on a variant and an `upsert-tenant` schema that differs from the base are refused with `variables_inherited_from_base`; `patch-draft` also refuses a change of `variantOf` (`variant_of_immutable`). The overview query rows carry `variantOf` (base slug or null), `variantsEnabled` and `locale`, and list a variant right after its base; the document designer shows them and offers "Variante anlegen" on bases that allow variants. The new query `template-resolver:query:variants` ({baseSlug, locale}) returns the active variants as {slug, title, scope, locale}, system and own, never another tenant's. Editing and delivery of variants follow the base's entry, so removing the base from `tenantEditable` stops serving tenant variants. `seedSystemTemplate` takes `variantOf` for system variants.
-->

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: renderPdfBeforeTransaction and renderPdfBytes take a variant
detail: `RenderPdfArgs` has `variant?: string`, the slug of a variant of `slug` from the template-resolver `variants` query; it is rendered instead of the base and stored as the rendered PDF's template slug. A variant that is not served to the tenant or does not belong to `slug` fails with the 422 reason `template_variant_unknown`.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: patch-draft description tells agents to use heading blocks for section titles
detail: The `patch-draft` description says that a heading stays with the block that follows it on print, so section titles should be `heading` blocks.
-->

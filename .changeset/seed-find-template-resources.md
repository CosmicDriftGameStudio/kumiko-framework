---
"@cosmicdrift/kumiko-framework": minor
---

Seeds can look up template rows with ctx.findTemplateResources

`SeedMigrationContext.findTemplateResources(filter?)` returns the template resource rows (`id`, `tenantId`, `slug`, `kind`, `locale`, `status`) ordered by slug and locale. The filter takes `tenantId` (default: the system tenant), `slug`, `kind`, `status` and `locale`. Without the template-resolver feature mounted it returns an empty list.

<!-- kumiko-changes
feature: framework
type: improvement
title: Seeds can find template rows with ctx.findTemplateResources
detail: Seeds can replace a raw SELECT … FROM read_template_resources with ctx.findTemplateResources, which binds every filter value as a parameter.
-->

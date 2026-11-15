---
"@cosmicdrift/kumiko-bundled-features": patch
---

The template-resolver `variants` query is open to every signed-in user of the tenant instead of the roles TenantAdmin and User, so an app-owned role (for example a property manager) can pick a variant. It still returns only the system variants and the caller's own tenant's.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: The variants query no longer requires TenantAdmin or User
detail: `template-resolver:query:variants` is open to every authenticated user, because whoever may create a document from a base template must be able to list its variants and an app's role names are unknown to the framework. The result is unchanged: slug, title, scope and locale of the active system variants and the caller's own tenant's variants, never another tenant's.
-->

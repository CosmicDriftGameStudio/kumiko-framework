---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

Notifications can keep their mail template system-only

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Notifications can keep their mail template system-only
detail: r.notification(name, { systemOnly: true }) marks the stored mail template as a platform text. Tenant admins no longer see it in the template overview, list or detail, and creating a tenant version (upsert-tenant, copy-locale, import-bundle, also a SystemAdmin writing for a tenant) is refused with access_denied and templateResolver.errors.systemOnlyTemplate. SystemAdmins edit the system template as before, and the mail renderer always uses it, even if a tenant row exists from before.
-->

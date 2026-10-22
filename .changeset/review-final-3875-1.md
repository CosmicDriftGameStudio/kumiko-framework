---
"@cosmicdrift/kumiko-bundled-features": patch
---

`send-test-status` now uses the same roles as `send-test`: SystemAdmin plus the roles of the `tenantEditable` entries. Before, it was fixed to TenantAdmin and SystemAdmin, so an editor with an opt-in role got a 403 and a permanently disabled test-mail button, while a TenantAdmin without edit rights was told `canSend: true` and hit a 403 on click.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: send-test-status follows the tenantEditable roles
detail: send-test-status takes its access from templateEditAccess(policy.tenantEditable), like send-test. Roles that may send a test mail now get the status, and a TenantAdmin without an edit opt-in gets a 403 on both.
-->

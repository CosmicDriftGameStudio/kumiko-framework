---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix: `change-password` and `logout` no longer return 403 for members whose only role is a custom app role or `TenantAdmin`

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Password change and logout work for members with only an app role or TenantAdmin
detail: Both handlers required User, Admin or SystemAdmin and answered 403 access_denied for invited members holding a single custom role. They are now open to every signed-in user, like the other self-service handlers; anonymous callers are still rejected.
-->

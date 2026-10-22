---
"@cosmicdrift/kumiko-bundled-features": minor
---

auth-mfa gets a `systemAdmins` required policy that makes MFA mandatory for SystemAdmins only.

<!-- kumiko-changes
feature: auth-mfa
type: improvement
title: requiredPolicy "systemAdmins"
detail: The new auth-mfa:config:required value systemAdmins (between optional and admins) forces MFA enrollment only for users whose merged global and tenant roles contain SystemAdmin. TenantAdmins and other roles log in as before; enrolled users are always challenged regardless of policy. No locale labels are involved, the option list has none.
-->

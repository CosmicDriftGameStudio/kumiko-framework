import { access } from "@cosmicdrift/kumiko-framework/engine";

// Every built-in membership rank (role-assignment.ts: User < Editor < Admin <
// TenantAdmin < SystemAdmin), so a regular team member can see their own
// tenant's usage. Deliberately not `access.authenticated` — that preset omits
// TenantAdmin and would revoke the access TenantAdmins already have. The
// screen and the query that fills its cards must carry the SAME rule, or the
// dashboard renders and every card 403s.
export const MY_CAPS_ACCESS_ROLES = access.roles("User", "Editor", ...access.admin);

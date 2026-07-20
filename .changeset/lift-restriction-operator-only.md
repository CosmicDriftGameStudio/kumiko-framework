---
"@cosmicdrift/kumiko-bundled-features": major
---

`user-data-rights:write:lift-restriction` is now operator-only: `access` changed from `openToAll` to `access.admin` (Admin/SystemAdmin/TenantAdmin), and the payload now requires an explicit `userId` target instead of implicitly acting on the caller. A Restricted user's own session is unconditionally rejected by `sessionChecker`'s blocked-status check, so there was never a working self-service path through this handler — apps calling it as the affected user themselves need to switch to an admin/operator actor with `{ userId }`.

`user-data-rights:write:restrict-account` stays self-service by default (`userId` in the payload is optional, defaults to the caller) but now also accepts an admin-targeted `userId` for an operator to restrict an account the user themselves can no longer reach.

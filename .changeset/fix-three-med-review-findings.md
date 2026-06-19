---
"@cosmicdrift/kumiko-framework": patch
---

Fix three Med review findings:

- **screen-filter (#343/1):** `decimal` fields are now comparable — `getAllowedFilterOps` returns the full `eq/ne/lt/gt/in` set instead of the empty default, so a `filterable: true` decimal field is no longer rejected by the boot-validator ("Allowed ops: (none)").
- **auth-cookies (#321/1):** `setAuthCookies` now invalidates the host-only cookie variant when `cookieDomain` is set (symmetric to `clearAuthCookies`), preventing a stale host-only auth/csrf cookie from coexisting with the domain-scoped cookie after a deploy that introduces `cookieDomain`.
- **test hygiene (#315/1):** `data-table-logic` test restores `NODE_ENV` by `delete`-ing it when it was previously unset, instead of writing the string `"undefined"` into the env (global-state leak into later tests).

---
"@cosmicdrift/kumiko-testing": patch
---

`expectRoleRestrictedHandlersDenyForeignRole` expects 404 not_found from dispatchOnly write handlers.

<!-- kumiko-changes
feature: testing
type: fix
title: Access contract accepts dispatchOnly handlers
detail: A write handler with `dispatchOnly: true` is not reachable over HTTP, so the HTTP entry answers it with the 404 not_found of an unknown handler before any role check. `expectRoleRestrictedHandlersDenyForeignRole` from `@cosmicdrift/kumiko-testing/helpers` now requires exactly that 404 not_found for role-restricted dispatchOnly handlers and still requires 403 access_denied from every other role-restricted handler. A dispatchOnly handler that answers over HTTP anyway, or a regular handler that answers 404, is reported as a deviation.
-->

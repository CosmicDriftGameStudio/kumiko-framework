---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes (final round), signature list page-cap test.

<!-- kumiko-changes
feature: signature
type: fix
title: List cursor of subject-scoped users is sealed
detail: The request list returned the plain cursor of the last base page, which could name a request of a foreign subject. Scoped users now get an encrypted cursor bound to their user and tenant, a plain or foreign cursor is answered with access denied, and `authorizeSubject` now requires a non-empty `linkSecret` because the cursor key is derived from it. A scoped user asking for `limit: 0` is refused like `offset`.
-->

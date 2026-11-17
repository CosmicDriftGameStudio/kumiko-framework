---
"@cosmicdrift/kumiko-framework": patch
---

A signature extraRoute that overlaps another /api route now fails at boot.

<!-- kumiko-changes
feature: framework
type: fix
title: Signature routes cannot shadow authenticated /api routes
detail: An `entry: "signature"` extraRoute skips the JWT, origin and CSRF chain for every request its pattern matches. Boot now rejects a signature route whose method and path overlap a mounted framework /api route (e.g. `GET /api/files/:id`) or a non-signature extraRoute (e.g. `GET /api/hooks/:id` next to a user route `GET /api/hooks/me`), so it can no longer make that route public.
-->

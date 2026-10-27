---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

A file upload with a revoked or expired session sends the user to the login with the session-ended banner.

<!-- kumiko-changes
feature: framework
type: fix
title: A file upload with an ended session ends up at the login
detail: POST /files answered an anonymous caller (revoked or expired session) with 403 forbidden or a validation error, so the browser showed an upload error instead of the login. Anonymous callers can never use an upload (they cannot bind pending files), so every upload without a session now answers 401 with code unauthenticated before the body is read, and the file upload fields signal the ended session like any other request. Signed-in callers without permission still get 403.
-->

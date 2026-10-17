---
"@cosmicdrift/kumiko-framework": patch
---

A stream whose token expires mid-stream now fails with 401 `unauthenticated`

<!-- kumiko-changes
feature: framework
type: fix
title: Mid-stream token expiry returns 401 unauthenticated
detail: A stream dispatched with a token that expires while the stream is open now ends with UnauthenticatedError (401) instead of AccessDeniedError (403), so clients show the session-ended hint. Access revocation mid-stream still returns 403 access_denied.
-->

---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

An anonymous write under the system tenant now runs only for handlers that declare `tenantlessAnonymous`.

<!-- kumiko-changes
feature: framework
type: breaking
title: Anonymous writes under the system tenant need tenantlessAnonymous
detail: POST /api/write, /api/batch and /api/command reject an anonymous write whose tenant is SYSTEM_TENANT_ID with 422 tenant_required unless the handler declares `tenantlessAnonymous: true`, no matter whether `anonymousAccess.defaultTenantId`, a tenant resolver or the tenantless fallback set the tenant. Unknown handlers still answer 404, handlers the anonymous role cannot call still answer 401, and signed-in users are unaffected. The bundled intake writes (user-data-rights request-deletion-by-email, confirm- and cancel-deletion-by-token, tenant-inactivity keep-account, waitlist and helpdesk submit, signature open-, sign- and decline-by-link) now declare it, so they also run under the tenantless fallback on hosts that resolve no tenant.
migration: Add `tenantlessAnonymous: true` to every app write handler that anonymous visitors call while the request resolves to SYSTEM_TENANT_ID; boot then requires `access: { roles: ["anonymous"] }` (anySignedIn and personalData allowed) and a rateLimit per "ip" or "ip+handler", including any `rateLimit` override you pass to the waitlist or helpdesk feature. App guards that rejected the system anchor per handler can be removed.
-->

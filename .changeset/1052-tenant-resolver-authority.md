---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`AnonymousAccessConfig.tenantResolver` now requires a `resolverTrust: "authoritative" | "fallback-only"` (compile-time — the type is a discriminated union — plus a runtime boot-throw for callers that bypass the compiler). Previously a client-supplied `X-Tenant` header/`kumiko_tenant` cookie always won over a custom `tenantResolver`, even one deriving the tenant from the subdomain, which the client cannot forge — letting a guest on one tenant's subdomain override the tenant via a forged header. `resolverTrust: "authoritative"` makes the resolver's answer final (a disagreeing client tenant is rejected with `tenant_mismatch`, and a null resolver answer does not fall back to the client tenant either); `resolverTrust: "fallback-only"` preserves the old behavior for resolvers with no more trust than the client's own claim.

Added `HttpRouteHandlerDeps.systemQuery` — an in-process query-handler dispatch that forces a specific tenant without going through the public `/api/query` HTTP layer, for routes (like `legal-pages`) that need to serve a fixed tenant (e.g. `SYSTEM_TENANT_ID`) regardless of the visited host.

Consumers with an existing `anonymousAccess.tenantResolver` must add a `resolverTrust` value — pick `"authoritative"` for subdomain/host-derived resolvers, `"fallback-only"` to keep the previous precedence.

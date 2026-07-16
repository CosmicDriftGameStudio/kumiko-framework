---
"@cosmicdrift/kumiko-bundled-features": patch
---

`managed-pages`' `GET {basePath}/:slug` render route and `seo`'s `sitemap.xml`/`llms.txt` routes now use the `systemQuery` in-process dispatch (introduced for `legal-pages` in the `resolverTrust` fix) instead of an internal `app.fetch` self-request with a forged `X-Tenant` header. That self-fetch carried no `Host` header (Host is only implied by the request URL, never stored in `Headers`), so a host-based `anonymousAccess.tenantResolver` reading only the header resolved `null` for the inner request. Under `resolverTrust: "authoritative"` there is no client-tenant fallback for a `null` resolution, so the route failed with `tenant_required` (503 "page unavailable" / empty sitemap entries) even for a legitimate, correctly-routed visitor. `systemQuery` forces the already host-resolved tenant in-process — no header round-trip, nothing that can go missing.

Consumers running `managed-pages` or `seo` with `resolverTrust: "authoritative"` should upgrade — the render/discovery routes were not reliably servable under that mode before this fix.

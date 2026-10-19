---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Host routing takes an app resolver, redirects and a per-host anonymous query allowlist; legal pages pass `alternates` to the layout; account-security constants have a client-safe subpath.

`createHostRoutingFeature` and `createHostDispatch` accept `tenantBy: (host, db) => TenantId | null` next to `"host"` and `"path"`. The resolver maps every host that is neither the apex nor a fixed host (profile subdomains, custom domains) to a tenant; the result must still be an enabled, active tenant, and null answers 404 on the page side and `tenant_required` on the API side. `tenantPathPrefix` is now optional in host and resolver mode and serves `<prefix>/<key>` on the apex next to the host tenants. `redirects: [{ from, to, host?, status? }]` are checked before any host classification; `to` is a configured same-origin path or https URL, only the matched path remainder and the query string are appended. `apexAnonymousQueryAllowlist: { [apexHost]: [queryType] }` limits which `/api/query` types get the `apexAnonymousTenantId` anchor on that host; without an entry the behavior is unchanged. `createHostTenantIdResolver(options, db)` returns a `host => TenantId | null` function for managed-pages' `resolveApexTenant`.

`createLegalPagesLayout` hands `alternates` (locale to path of the same page) as the second argument to `headerHtml` and `footerHtml`, and the legal-pages routes now supply it for slugs served in more than one language. `@cosmicdrift/kumiko-bundled-features/account-security/constants` exports the feature id, screen id, screen QN, nav label and the new `ACCOUNT_SECURITY_SCREEN_TITLE_KEY` without server imports.

<!-- kumiko-changes
feature: host-routing
type: improvement
title: tenantBy resolver, apex path tenants, redirects and anonymous query allowlist
detail: tenantBy accepts (host, db) => TenantId | null for profile subdomains and custom domains; tenantPathPrefix also works in host and resolver mode for apex path tenants. redirects send fixed 301/302 answers before host classification, apexAnonymousQueryAllowlist limits the anonymous apex anchor to listed query types per host, and createHostTenantIdResolver(options, db) maps a Host header to its tenant for managed-pages. Existing "host" and "path" configs behave as before.
-->

<!-- kumiko-changes
feature: legal-pages
type: improvement
title: Legal layout receives alternates
detail: createLegalPagesLayout passes alternates as second argument to headerHtml and footerHtml, and legal-pages routes provide the other-language paths of the same slug, so a layout can render a language switch.
-->

<!-- kumiko-changes
feature: account-security
type: improvement
title: Client-safe account-security/constants subpath
detail: "@cosmicdrift/kumiko-bundled-features/account-security/constants" exports ACCOUNT_SECURITY_FEATURE, the screen id and QN, the nav label and the new ACCOUNT_SECURITY_SCREEN_TITLE_KEY without importing server code.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Demo-mode accounts can carry a label
detail: demoMode.notice.accounts entries may be { role, label? } next to a bare role; the GET /demo-mode payload then lists { role, label?, email, password } so the banner can name each login. Bare roles behave as before.
-->

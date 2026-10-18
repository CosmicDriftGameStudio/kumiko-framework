# host-routing

Tenant routing by host or path for apps with tenant subdomains, a tenant path
prefix or locale-prefixed marketing pages. Two halves:

- `createHostRoutingFeature(options)`: the server half. In `tenantBy: "host"` it
  registers an authoritative tenant resolver (`<key>.<baseDomain>` → tenant),
  so anonymous API calls get their tenant from the Host header only; a
  disagreeing `X-Tenant` header or cookie answers `400 tenant_mismatch`, and the
  apex or an unknown host answers `400 tenant_required`. Set
  `apexAnonymousTenantId` and the apex answers as that tenant instead (host
  mode: authoritative; path mode: only when the client names no tenant). Path
  keys may be any 1 to 50 unreserved URL characters, subdomain keys must be
  one lowercase DNS label. In both modes it
  registers a tenant existence check: a client-named tenant must exist, be
  enabled and be active. It also owns the anonymous, rate-limited
  `host-routing:query:tenant-key-exists` query.
- `createHostDispatch(options)`: the page half for `runProdApp({ hostDispatch })`.
  It picks the HTML file and optional CSP per host, answers the locale redirect
  and returns 404 for unknown tenants and unknown hosts.

The dev server uses the same decision through
`toDevHostDispatch(dispatch, { entries, staticDir })` from
`@cosmicdrift/kumiko-dev-server`.

## Setup

```typescript
import {
  createHostDispatch,
  createHostRoutingFeature,
  type HostRoutingOptions,
} from "@cosmicdrift/kumiko-bundled-features/host-routing";
import { resolveAnonymousAccessFromRegistry } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";

const routing: HostRoutingOptions = {
  tenantBy: "host",
  baseDomain: "example.com",
  apex: { file: "index.html", localeFiles: { en: "en/index.html" } },
  tenant: { file: "app.html", csp: "default-src 'self'; frame-ancestors 'none'" },
  unknownTenant: { file: "unknown-tenant.html" },
  hosts: { "admin.example.com": { file: "admin.html" } },
  locales: { default: "de", prefixed: ["en"] },
};

runProdApp({
  features: [...FEATURES, createHostRoutingFeature(routing)],
  anonymousAccess: () => ({}),
  hostDispatch: createHostDispatch(routing),
});
```

`anonymousAccess` stays an app opt-in: the providers are merged in only when
the app sets it.

## Options

| Option | Meaning |
|---|---|
| `tenantBy` | `"host"` (`<key>.<baseDomain>`) or `"path"` with `tenantPathPrefix` (`/t/<key>/...` on the apex) |
| `baseDomain` | Apex hostname, lowercase, no port. `www.<baseDomain>` counts as apex |
| `apex` | `{ file, csp?, localeFiles? }` for the apex |
| `tenant` | `{ file, csp? }` for a known tenant and for the bare path prefix |
| `unknownTenant` | `{ file, csp? }` served with 404; omit for a bare 404 |
| `hosts` | Further fixed hostnames with their own surface, checked first |
| `apexAnonymousTenantId` | Tenant for anonymous API calls on the apex (e.g. `SYSTEM_TENANT_ID` for public signup); omit and the apex has none |
| `locales` | `{ default, prefixed }`: `/<default>/...` answers 301 to the unprefixed path, `/<prefixed>/...` serves `apex.localeFiles[locale]` |

A `csp` replaces runProdApp's default CSP for that surface; without it the
default applies. Options are validated when the feature or dispatch is built.

## Security

- Only plain DNS names (optional port) are routed. `X-Forwarded-Host` is never
  read; userinfo, IPv6 literals, lists or nested subdomains fall to a bare 404
  without a lookup.
- Redirect targets are same-origin paths; leading slashes and backslashes are
  collapsed, so `/de//evil.example` never becomes a protocol-relative URL.
- The key query returns only `{ exists }`, which the 404 page makes public
  anyway. Over its rate limit the dispatch serves the tenant shell; the API
  behind it still resolves the tenant itself.
- In `tenantBy: "path"` no resolver is registered, so the client names its
  tenant with `X-Tenant`; the existence check still rejects unknown, disabled
  and destroyed tenants.

## Not covered

Custom domains per tenant, legacy host redirects and app-specific query
allowlists stay in the app: wrap the dispatch function and fall through to it.

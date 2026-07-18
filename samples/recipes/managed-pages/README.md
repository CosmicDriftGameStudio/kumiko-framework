# Recipe: managed-pages

Tenant-editable, server-rendered public pages with per-tenant branding and
opt-in, tier-gated **custom CSS** — the framework generalization of the
`legal-pages`/`wrapLayout` render pattern, hardened for untrusted tenant input.

**What the recipe demonstrates:**
- Compose `managed-pages` (+ its `config` dependency and the `managed-pages-css`
  companion toggle) in `runProdApp({ features: [...] })`
- Required wirings: `anonymousAccess` + `extraContext` config plumbing
- Single-tenant `resolveApexTenant` (multi-tenant resolves from the Host)
- The render boundary: published-only, Markdown raw-HTML escaped, per-tenant
  branding applied as scoped `:root` vars, custom CSS allowlist-sanitized and
  contained in a `<style data-tenant-css>` block
- 6 integration tests proving end-to-end behavior

## Layout

```
samples/recipes/managed-pages/
├── package.json                # workspace deps
├── README.md                   # this file
└── src/
    ├── feature.ts              # the composed features re-exported for tests
    └── __tests__/
        └── feature.integration.test.ts  # 6 tests: render + branding + CSS
```

## Run tests

```bash
# From the repo root:
bun kumiko test all samples/recipes/managed-pages/
```

When the tests are green:
- A published page is reachable via `stack.app.request("/p/about")`; a draft is `404`
- Per-tenant content is cache-isolated (`Vary: Host`)
- Raw HTML in a Markdown body is escaped (no `<script>` execution)
- Branding writes (`config:write:set`) roundtrip into the rendered HTML
- Attack CSS (`position:fixed`, `@import`, `url()`) is neutralized at render

## Integration into a real app

### 1. Compose the features

```typescript illustration
// bin/main.ts
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import {
  createManagedPagesFeature,
  createManagedPagesCssFeature,
} from "@cosmicdrift/kumiko-bundled-features/managed-pages";

await runProdApp({
  features: [
    createManagedPagesFeature({
      // Host → tenantId. Single-tenant returns a constant; multi-tenant maps
      // the subdomain / custom domain. NULL → 404 (no tenant for this host).
      resolveApexTenant: (host) => resolveTenantForHost(host),
      // Opt-in custom CSS (default false, fail-closed). The render-time
      // sanitizer is the safety boundary; gate per tier with the companion.
      allowCustomCss: true,
    }),
    createManagedPagesCssFeature(),
    /* ... your other features */
  ],
  // routes run anonymous; multi-tenant honors the per-page X-Tenant header
  anonymousAccess: { tenantExists: async (id) => /* validate */ true },
});
```

`config` is auto-mounted by `runProdApp`. In `setupTestStack` it is **not**, so
the recipe lists `createConfigFeature()` explicitly (see `src/feature.ts`).

> **anonymousAccess:** a fixed `defaultTenantId` locks single-tenant and rejects
> the per-page `X-Tenant` with `400 tenant_mismatch` unless it equals the
> default. Multi-tenant apps wire `tenantExists` (or a `tenantResolver`) and let
> the route's `X-Tenant` win.

### 2. Create the table

```bash
bun kumiko migrate generate    # detects the `page` entity → SQL migration
bun kumiko migrate apply
```

### 3. Authoring + branding

- Pages: TenantAdmin/SystemAdmin author via the `entityList`/`entityEdit`
  screens (`managed-pages:screen:page-list`); wire nav/workspace onto them.
- Branding: the `configEdit` screen (`managed-pages:screen:branding-settings`)
  or `config:write:set` against the `BRANDING_QN.*` keys
  (`managed-pages:config:branding-{title,accent-color,...,custom-css}`).

### 4. Per-tenant CSS gating

`createManagedPagesCssFeature()` is `r.toggleable({ default: false })`. To gate
custom CSS per tier, wire `feature-toggles`/`tier-engine` so the
`managed-pages-css` toggle is on only for entitled tenants. **Without a toggle
runtime, `ctx.hasFeature` fails open** — the capability stays on. The fail-closed
anchor is `allowCustomCss` (app-level opt-in); the toggle is the commercial gate.

## Custom wrapLayout (your own marketing chrome)

A custom `wrapLayout` receives `branding` RAW and untrusted: `title`/
`description` are length-capped at write but **not** HTML-escaped, and
`customCss` is unsanitized. Emit every tenant value through the exported
boundary helpers — never interpolate `branding.title` yourself (stored XSS):

```typescript illustration
import {
  brandingHeaderHtml,
  brandingStyleBlock,
  tenantStyleBlock,
  TENANT_CONTENT_ATTR,
} from "@cosmicdrift/kumiko-bundled-features/managed-pages";

const wrapLayout = (o) => `<!doctype html>
<html lang="${o.lang}">
<head>
  <title>${o.title}</title>
  ${/* your layout CSS */ ""}
  ${brandingStyleBlock(o.branding)}            <!-- escaped :root theme vars -->
  ${tenantStyleBlock(o.branding.customCss)}    <!-- scoped + sanitized + contained -->
</head>
<body>
  ${brandingHeaderHtml(o.branding)}            <!-- escaped logo + title header -->
  <main ${TENANT_CONTENT_ATTR}>${o.bodyHtml}</main>
</body>
</html>`;
```

`brandingHeaderHtml`/`brandingStyleBlock` escape + re-validate (hex/https) the
branding tokens; `tenantStyleBlock` bakes in the scope selector so callers can't
mis-scope and lose containment. The default skeleton (`wrapInLayout`) uses the
exact same helpers.

## Security posture

| Threat | Mitigation |
|---|---|
| `<script>`/raw HTML in a page body | `renderSafeMarkdown` escapes raw HTML (Markdown-only) |
| Cross-tenant content on a shared CDN | `Vary: Host` + per-tenant `resolveApexTenant` |
| Draft leak to anonymous visitors | published-only; drafts → 404 |
| `@import`/`url()`/`expression()`/`</style>` in custom CSS | allowlist-by-construction sanitizer (rebuilt from validated tokens) |
| Scope-escape / overlay onto host chrome | scope-prefix + `position`/`isolation`/`overflow` containment |
| Untrusted tenant abusing CSS | tier-gate (`managed-pages-css`) + `allowCustomCss` opt-in |

Custom-CSS sanitization for untrusted tenants is **best-effort defense-in-depth**:
a tenant can still restyle its **own** page area within the clip. Keep it
tier-gated.

## Cross-refs

- [packages/bundled-features/src/managed-pages](../../../packages/bundled-features/src/managed-pages) — the feature
- [packages/bundled-features/src/page-render/css-sanitize.ts](../../../packages/bundled-features/src/page-render/css-sanitize.ts) — the allowlist sanitizer
- [samples/recipes/legal-pages](../legal-pages) — the simpler, static sibling

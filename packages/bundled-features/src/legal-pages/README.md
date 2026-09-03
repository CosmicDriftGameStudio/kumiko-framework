# legal-pages

Opt-in wrapper around [`template-resolver`](../template-resolver/) text-blocks for
DACH compliance. Ships four fixed public HTML routes
(`/legal/impressum`, `/legal/datenschutz`, `/legal/imprint`,
`/legal/privacy`) with Markdown→HTML rendering and a boot check that
hard-fails in production when the DE required blocks aren't seeded.

**Opt-in.** Internal tools, US apps without an imprint requirement,
or hobby projects without public access simply don't activate the
feature.

---

## Setup

```typescript
import { createLegalPagesFeature } from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import {
  createTemplateResolverApi,
  createTemplateResolverFeature,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

runProdApp({
  features: [
    createTemplateResolverFeature(),  // legal-pages requires template-resolver
    createLegalPagesFeature(),
    /* ... */
  ],
  // Two wirings are required:
  //   1. anonymousAccess for /legal/* routes (run without a JWT)
  //   2. extraContext.templateResolver for the boot check (cross-feature
  //      decoupling — legal-pages imports no code from template-resolver,
  //      only uses the API via ctx)
  anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  extraContext: ({ db }) => ({
    templateResolver: createTemplateResolverApi(db),
  }),
});
```

---

### Production table setup

legal-pages doesn't have its own table — it stores its blocks as
`kind: "text-block"` rows in template-resolver's `read_template_resources`.
Table setup therefore goes through template-resolver:

```bash
bun kumiko schema generate <name>   # template-resource entity is detected
bun kumiko schema apply
```

See [template-resolver/README.md](../template-resolver/README.md).

## Routes

**Default** (DACH: DE required, EN optional):

| Path | Slug + locale | Title fallback (when block empty) |
|---|---|---|
| `GET /legal/impressum` | `imprint` / `de` | "Impressum" |
| `GET /legal/datenschutz` | `privacy` / `de` | "Datenschutzerklärung" |
| `GET /legal/imprint` | `imprint` / `en` | "Imprint" |
| `GET /legal/privacy` | `privacy` / `en` | "Privacy Policy" |

Response:
- `200 text/html` — block exists + has content. Cache header `public, max-age=300`.
- `404 text/plain` — block missing. Hint: "Tenant admin must set this text block".
- `503 text/plain` — `app.fetch` to `/api/query` failed (anonymousAccess missing?).

Layout: a minimal HTML5 skeleton with inline CSS — apps that want to
integrate into their own layout use `template-resolver:query:by-slug`
directly and render themselves.

---

### Non-DACH apps: custom routes + required blocks

The default four routes and the two DE required blocks
(`LEGAL_ROUTES`/`LEGAL_REQUIRED_BLOCKS`) are DACH conventions, not a
hard constraint. An app with a different default language, or one
that needs an additional page (terms/AGB), passes its own lists:

```typescript
createLegalPagesFeature({
  routes: [
    { path: "/legal/aviso-legal", slug: "imprint", lang: "es", titleFallback: "Aviso legal" },
    { path: "/legal/privacidad", slug: "privacy", lang: "es", titleFallback: "Política de privacidad" },
    { path: "/legal/terminos", slug: "terms", lang: "es", titleFallback: "Términos y condiciones" },
  ],
  requiredBlocks: [{ slug: "imprint", lang: "es" }, { slug: "privacy", lang: "es" }],
})
```

`slug` is free-form — it only has to match the `slug` you seed the
text-block under via `template-resolver`. `requiredBlocks` drives the
boot check (see below); routes not listed there stay optional and
just 404 until seeded, same as the DACH default.

Validated once at feature-build time (fails app startup, not a
request): no two routes may share a `path`, every route needs a
non-empty `path`/`slug`/`lang`, and every `path` must start with `/`.
An empty `routes` array is allowed — the boot check alone, no public
routes.

---

## Boot check

`r.job` with `runOnBoot: true` checks at app start whether the
required blocks exist in SYSTEM_TENANT. **Default** (DACH):

| Slug + locale | What happens when missing |
|---|---|
| `imprint` / `de` | **Production:** `throw new Error(...)` blocks app start. **Dev:** `ctx.log.warn(...)` |
| `privacy` / `de` | as above |

EN versions are **not** boot-fail-relevant by default (`LEGAL_OPTIONAL_BLOCKS`).
Routes return `404` if an EN block is missing.

→ Apps that activate the feature with the default config must seed
both DE blocks before a production deploy — either via a bootstrap
script (`seedTextBlock`) or manually via the TenantAdmin API.

→ Apps with a `requiredBlocks` override (see above) get the same
production-hard-fail/dev-warn behavior for their own slug/lang list
instead — the DE blocks are not checked when `requiredBlocks` is set.

---

## TenantAdmin maintenance via the API

Tenant admins (or platform SystemAdmin for SYSTEM_TENANT texts) can
update content at any time through the standard write handler:

```typescript
// From the tenant admin frontend (or admin curl):
await fetch("/api/write", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({
    type: "template-resolver:write:set",
    payload: {
      slug: "imprint",
      locale: "de",
      title: "Impressum",
      content: "## Angaben gemäß § 5 TMG\n\n...",
    },
  }),
});
```

→ Idempotent: a second call with the same `(slug, locale)` updates the block.
ACL: `roles: ["TenantAdmin", "SystemAdmin"]` — SystemAdmin (a global
role) may set SYSTEM_TENANT texts, TenantAdmin only tenant-owned ones.

→ The route's cache header is `public, max-age=300` — after an update,
visitors see new content within 5 minutes at most. If you need
instant visibility, you can help things along with a CDN purge.

## Seeding

On first app boot or via migration:

```typescript
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

await seedTextBlock(db, {
  tenantId: SYSTEM_TENANT_ID,
  slug: "imprint",
  locale: "de",
  title: "Impressum",
  content: `## Angaben gemäß § 5 TMG

**Marc Frost**

Slevogtstr. 10
04159 Leipzig

## Kontakt

E-Mail: hello@example.com`,
});
```

Templates for imprint + privacy policy: see
[docs/plans/datenschutz/legal-artifacts.md](../../../../docs/plans/datenschutz/legal-artifacts.md)
and vetted external generators (e-recht24.de,
datenschutz-generator.de).

---

## XSS hardening (untrusted authors)

The server-render path is hardened for untrusted tenant authors —
no DOMPurify dependency needed:

- **Raw HTML is escaped, not passed through.** `renderMarkdownToHtml`
  (`markdown.ts`) configures `marked` so block- and inline-level HTML
  tokens are emitted as escaped text (`<script>` → `&lt;script&gt;`).
  Markdown structure (headings, lists, links, code) stays intact.
- **Link/image hrefs are scheme-restricted** to `http(s)`/`mailto`/
  relative; `javascript:`/`data:` hrefs are neutralised to `#`.
- **Defense-in-depth headers** on every response (`security-headers.ts`):
  `content-security-policy: script-src 'none'; object-src 'none';
  base-uri 'none'` (no script can run even if injection slips through),
  plus `x-content-type-options`, `x-frame-options`, `referrer-policy`.
  No `default-src`, so inline `<style>` layouts stay unaffected.

---

## Tenant model

**1 app = X tenants = 1 imprint.** All subdomains/tenant hosts of a
Kumiko app share the SYSTEM_TENANT version of the legal pages. If you
need per-tenant imprints (rare — typical case: the platform operator
is the responsible party, not the tenant customer), call
the by-slug query directly with a tenant-specific TenantId
and put your own routes in front.

---

## Architecture cross-refs

- [docs/plans/datenschutz/](../../../../docs/plans/datenschutz/)
  — consolidated privacy plan index
- [docs/plans/datenschutz/legal-artifacts.md](../../../../docs/plans/datenschutz/legal-artifacts.md)
  — templates + where-is-what for imprint/AVV/TOMs/RoPA
- [docs/plans/datenschutz/compliance-as-product.md](../../../../docs/plans/datenschutz/compliance-as-product.md)
  — roadmap for auto-generation (sub-processor list, TOMs, data-breach workflow)
- [samples/recipes/legal-pages/](../../../../samples/recipes/legal-pages/)
  — live sample with both features wired up

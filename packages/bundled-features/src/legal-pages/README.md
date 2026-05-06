# legal-pages

Opt-in wrapper around [`text-content`](../text-content/) for
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
  createTextContentApi,
  createTextContentFeature,
} from "@cosmicdrift/kumiko-bundled-features/text-content";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

runProdApp({
  features: [
    createTextContentFeature(),  // legal-pages requires text-content
    createLegalPagesFeature(),
    /* ... */
  ],
  // Two wirings are required:
  //   1. anonymousAccess for /legal/* routes (run without a JWT)
  //   2. extraContext.textContent for the boot check (cross-feature
  //      decoupling — legal-pages imports no code from text-content,
  //      only uses the API via ctx)
  anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  extraContext: ({ db }) => ({
    textContent: createTextContentApi(db),
  }),
});
```

---

### Production table setup

legal-pages doesn't have its own table — it uses text-content's
`read_text_blocks`. Table setup therefore goes through text-content:

```bash
yarn kumiko migrate generate    # text-block entity is detected
yarn kumiko migrate apply
```

See [text-content/README.md](../text-content/README.md#production-table-setup).

## Routes

| Path | Slug + lang | Title fallback (when block empty) |
|---|---|---|
| `GET /legal/impressum` | `imprint` / `de` | "Impressum" |
| `GET /legal/datenschutz` | `privacy` / `de` | "Datenschutzerklärung" |
| `GET /legal/imprint` | `imprint` / `en` | "Imprint" |
| `GET /legal/privacy` | `privacy` / `en` | "Privacy Policy" |

Response:
- `200 text/html` — block exists + has body. Cache header `public, max-age=300`.
- `404 text/plain` — block missing. Hint: "Tenant admin must set this text block".
- `503 text/plain` — `app.fetch` to `/api/query` failed (anonymousAccess missing?).

Layout: a minimal HTML5 skeleton with inline CSS — apps that want to
integrate into their own layout use `text-content:query:by-slug`
directly and render themselves.

---

## Boot check

`r.job` with `runOnBoot: true` checks at app start whether the DE
required blocks exist in SYSTEM_TENANT:

| Slug + lang | What happens when missing |
|---|---|
| `imprint` / `de` | **Production:** `throw new Error(...)` blocks app start. **Dev:** `ctx.log.warn(...)` |
| `privacy` / `de` | as above |

EN versions are **not** boot-fail-relevant (`LEGAL_OPTIONAL_BLOCKS`).
Routes return `404` if an EN block is missing.

→ Apps that activate the feature must seed both DE blocks before a
production deploy — either via a bootstrap script (`seedTextBlock`) or
manually via the TenantAdmin API.

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
    type: "text-content:write:set",
    payload: {
      slug: "imprint",
      lang: "de",
      title: "Impressum",
      body: "## Angaben gemäß § 5 TMG\n\n...",
    },
  }),
});
```

→ Idempotent: a second call with the same `(slug, lang)` updates the block.
ACL: `roles: ["TenantAdmin", "SystemAdmin"]` — SystemAdmin (a global
role) may set SYSTEM_TENANT texts, TenantAdmin only tenant-owned ones.

→ The route's cache header is `public, max-age=300` — after an update,
visitors see new content within 5 minutes at most. If you need
instant visibility, you can help things along with a CDN purge.

## Seeding

On first app boot or via migration:

```typescript
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/text-content/seeding";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

await seedTextBlock(db, {
  tenantId: SYSTEM_TENANT_ID,
  slug: "imprint",
  lang: "de",
  title: "Impressum",
  body: `## Angaben gemäß § 5 TMG

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

## XSS — currently not secured by design

`marked` renders HTML tags 1:1, so a malicious tenant admin could in
theory put `<script>` into the body.

Currently accepted because:
- only `roles: ["TenantAdmin"]` may set texts
- multi-author setups don't exist yet
- self-hosted tier without unknown tenant admins

**Phase-2 hardening:** `DOMPurify` or `isomorphic-dompurify`
sanitization step between `marked.parse()` and the response.
Documented when a customer with a multi-author setup shows up.

---

## Tenant model

**1 app = X tenants = 1 imprint.** All subdomains/tenant hosts of a
Kumiko app share the SYSTEM_TENANT version of the legal pages. If you
need per-tenant imprints (rare — typical case: the platform operator
is the responsible party, not the tenant customer), call
text-content's by-slug query directly with a tenant-specific TenantId
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

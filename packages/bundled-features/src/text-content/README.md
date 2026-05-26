# text-content

Generic Markdown text container — exactly one block per
`(tenantId, slug, lang)`. Use cases: imprint, privacy policy, FAQ,
about, ToS, marketing snippets. Foundation for
[`legal-pages`](../legal-pages/), but also usable standalone.

**Opt-in.** If you don't need static texts (internal tools, pure API
apps), simply don't activate the feature.

---

## Setup

```typescript
import { createTextContentFeature } from "@cosmicdrift/kumiko-bundled-features/text-content";

runProdApp({
  features: [createTextContentFeature(), /* ... */],
});
```

### Production table setup

Each app creates the `read_text_blocks` table via a schema migration:

```bash
# In the app workspace (legacy drizzle.config.ts apps):
bun kumiko migrate generate    # detects the new r.entity("text-block")
bun kumiko migrate apply       # pre-deploy step in prod

# New apps (kumiko/schema.ts):
bun kumiko schema generate text-content
bun kumiko schema apply
```

The boot gate (`runProdApp`) checks hard: missing table = `SchemaDriftError`,
container exits. No auto-heal in production. See
[docs/plans/architecture/migrations.md](../../../../docs/plans/architecture/migrations.md).

In integration tests (`bun test`) it's enough to do:

```typescript
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-framework/stack";
import { textBlockEntity } from "@cosmicdrift/kumiko-bundled-features/text-content";

await unsafeCreateEntityTable(stack.db, textBlockEntity);
```

The `unsafe` prefix is intentional — it bypasses the projection
registry and is reserved for test setup and framework-internals. Apps
declare data via `r.entity(...)` everywhere else.

## Use cases

text-content is generic — anything that's static Markdown text per
`(tenantId, slug, lang)` fits. Examples from real life:

| Slug example | Use case | Tenant scope |
|---|---|---|
| `imprint`, `privacy` | Imprint, privacy (DACH) | SYSTEM_TENANT_ID (app-wide) |
| `terms-of-service`, `eula` | Terms of service | SYSTEM_TENANT_ID or tenant-owned |
| `faq-billing`, `faq-onboarding`, `faq-troubleshooting` | FAQ sections | SYSTEM_TENANT_ID |
| `about-team`, `about-mission` | About pages | SYSTEM_TENANT_ID |
| `help-shortcuts`, `help-search` | In-app help texts | SYSTEM_TENANT_ID |
| `welcome-email-body`, `password-reset-body` | Email templates (Markdown body) | SYSTEM_TENANT_ID or tenant branding |
| `marketing-pricing-cta`, `marketing-feature-list` | Marketing snippets for landing pages | SYSTEM_TENANT_ID |
| `tenant-welcome-message` | Tenant-specific text | TenantId (each tenant maintains their own) |

Convention for slugs: `kebab-case`, hierarchy via `area-topic`
(e.g. `faq-billing` rather than `billing-faq` so list aggregation by
prefix is straightforward).

---

## API

### `text-content:write:set` — upsert per block

The tenant admin writes a block. Idempotent: if a block already exists
for `(tenantId, slug, lang)`, it's updated.

```typescript
import { TextContentHandlers } from "@cosmicdrift/kumiko-bundled-features/text-content";

await stack.http.writeOk(TextContentHandlers.set, {
  slug: "imprint",
  lang: "de",
  title: "Impressum",
  body: "## Angaben gemäß § 5 TMG\n\nMarc Frost ...",
}, tenantAdmin);
```

**Validation:**
- `slug` — kebab-case (`/^[a-z0-9][a-z0-9-]*$/`), max 64 chars
- `lang` — ISO 639-1 (`de`, `en`, `en-us`, ...)
- `title` — 1-200 chars
- `body` — Markdown, max 100000 chars, nullable

**Access:** `roles: ["TenantAdmin"]`. Tenant scope comes automatically
from `event.user.tenantId`. Platform admins (SystemTenant) set texts
through the SystemAdmin role in SYSTEM_TENANT_ID.

### `text-content:query:by-slug` — public read

Anonymous-capable (`roles: ["anonymous", "User", "TenantAdmin",
"SystemAdmin"]`) — visitors on marketing/legal pages should see texts
without a login.

```typescript
import { TextContentQueries } from "@cosmicdrift/kumiko-bundled-features/text-content";

const block = await stack.http.queryOk(TextContentQueries.bySlug, {
  slug: "imprint",
  lang: "de",
}, anyUser);
// → { slug, lang, title, body, updatedAt } | null
```

**Tenant scope:** comes from `query.user.tenantId`. For anonymous
requests the server must configure `anonymousAccess` with a
`defaultTenantId` or `tenantResolver`.

---

## Test helper

```typescript
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/text-content/seeding";

await seedTextBlock(db, {
  tenantId: SYSTEM_TENANT_ID,
  slug: "imprint",
  lang: "de",
  title: "Impressum",
  body: "...",
});
```

Idempotent: a second call updates the block.

---

## Cross-feature API (for consuming features)

When another feature (e.g. `legal-pages`) wants to read text blocks
**without a direct code import**, there's an extraContext API:

```typescript
import { createTextContentApi, requireTextContent } from "@cosmicdrift/kumiko-bundled-features/text-content";

// 1. App bootstrap wires the API:
runProdApp({
  features: [createTextContentFeature(), createLegalPagesFeature(), /* ... */],
  extraContext: ({ db }) => ({
    textContent: createTextContentApi(db),
  }),
});

// 2. In the consumer feature (e.g. legal-pages handler / boot job):
const textContent = requireTextContent(ctx, "my-handler");
const block = await textContent.getBlock({
  tenantId: SYSTEM_TENANT_ID,
  slug: "imprint",
  lang: "de",
});
```

Pattern is symmetrical to `config` ↔ `tenant`: `text-content` only
exports the type + factory, consuming features only import the type.
This means text-content can be refactored freely without breaking
other features — the contract is the `TextContentApi` interface.

## Combining with `legal-pages`

`legal-pages` is an opt-in wrapper that registers four fixed
convenience routes (`/legal/impressum`, `/legal/datenschutz`,
`/legal/imprint`, `/legal/privacy`) and renders Markdown→HTML. See
[../legal-pages/README.md](../legal-pages/README.md).

---

## Architecture

- **Single source of truth:** `textBlockEntity` in `table.ts`.
  The Drizzle table is derived via `buildEntityTable("text-block",
  textBlockEntity)`, the unique index on `(tenantId, slug, lang)` is
  declared via `entity.indexes`.
- **Event-sourced:** the write path goes through
  `createEventStoreExecutor` — `text-block.created` and
  `text-block.updated` land in the event stream, the projection row in
  the same TX. Subscribers (audit, search) receive the events.
- **Storage:** one block per `(tenantId, slug, lang)`. SYSTEM_TENANT_ID
  for app-wide texts, regular TenantId for tenant-owned ones.

Cross-refs: [../../docs/plans/datenschutz/](../../../../docs/plans/datenschutz/)
for the bigger privacy plan picture.

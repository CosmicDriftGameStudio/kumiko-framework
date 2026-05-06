# Recipe: legal-pages + text-content

DACH compliance stack: two opt-in bundled features wired up to
auto-rendered Imprint + Privacy-Policy pages, with Markdown authoring
and a boot check for required content.

**What the recipe demonstrates:**
- Activate both features in `runProdApp({ features: [...] })`
- Required wirings: `anonymousAccess` + `extraContext.textContent`
- Initial seed of the DE required blocks (Imprint + Privacy) for SYSTEM_TENANT
- 5 integration tests proving end-to-end behavior

## Layout

```
samples/recipes/legal-pages/
├── package.json                # workspace deps
├── README.md                   # this file
└── src/
    ├── feature.ts              # the two features re-exported for tests
    └── __tests__/
        └── feature.integration.ts  # 5 tests: routes + boot check
```

`feature.ts` is intentionally thin (re-export). In a real app this
lives in `bin/main.ts` (see "Integration into a real app" below).

## Run tests

```bash
# From the repo root:
yarn test:all run samples/recipes/legal-pages/
```

Expected output:
```
Test Files  1 passed (1)
     Tests  5 passed (5)
```

When the tests are green:
- text-content + legal-pages are compatible
- Table schema is clean via `unsafeCreateEntityTable(stack.db, textBlockEntity)`
- Routes are reachable via `stack.app.request("/legal/impressum")`
- Markdown rendering produces valid HTML
- Boot check correctly detects missing blocks

## Integration into a real app

Step-by-step for an existing Kumiko app (e.g.
`samples/showcases/your-app/`):

### 1. Activate features in `runProdApp`

```typescript
// bin/main.ts
import { runProdApp } from "@cosmicdrift/kumiko-dev-server";
import {
  createTextContentApi,
  createTextContentFeature,
} from "@cosmicdrift/kumiko-bundled-features/text-content";
import { createLegalPagesFeature } from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

await runProdApp({
  features: [
    createTextContentFeature(),
    createLegalPagesFeature(),
    /* ... your other features */
  ],
  // Required (1): routes run anonymous, need tenant resolution
  anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  // Required (2): boot check + internal lookup use ctx.textContent
  extraContext: ({ db }) => ({
    textContent: createTextContentApi(db),
  }),
});
```

→ For host-based multi-tenant apps (like publicstatus.eu),
`SYSTEM_TENANT_ID` always stays correct for legal-pages — the routes
internally set `X-Tenant: SYSTEM_TENANT_ID` and override any
host-based `tenantResolver`. This is the "1 app = X tenants = 1
imprint" decision.

### 2. Create the table

```bash
# In the app workspace:
yarn kumiko migrate generate    # detects text-block entity → SQL migration
yarn kumiko migrate apply       # one-time (pre-deploy step in prod)
```

### 3. Initial seed of the required blocks

A one-shot setup routine that runs on first boot or via the CLI:

```typescript
// bin/seed-legal.ts
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/text-content/seeding";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createDb } from "@cosmicdrift/kumiko-framework/db";

const db = createDb(process.env.DATABASE_URL!);

await seedTextBlock(db, {
  tenantId: SYSTEM_TENANT_ID,
  slug: "imprint",
  lang: "de",
  title: "Impressum",
  body: `## Angaben gemäß § 5 TMG

**[Dein Name / GmbH]**

[Strasse + Nr]
[PLZ Ort]
Deutschland

## Kontakt

E-Mail: [hello@example.com](mailto:hello@example.com)

## Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV

[Dein Name, Adresse]`,
});

await seedTextBlock(db, {
  tenantId: SYSTEM_TENANT_ID,
  slug: "privacy",
  lang: "de",
  title: "Datenschutzerklärung",
  body: `## 1. Verantwortlicher

[Dein Name + Anschrift]

## 2. Erhobene Daten

[...]`,
});
```

→ Templates for full legally-sound texts: e-recht24.de
or datenschutz-generator.de by Dr. Schwenke. See
[docs/plans/datenschutz/legal-artifacts.md](../../../docs/plans/datenschutz/legal-artifacts.md).

### 4. Visit the pages

After the seed these URLs are immediately live:

| URL | Content |
|---|---|
| `https://your-app.example/legal/impressum` | Impressum (DE) |
| `https://your-app.example/legal/datenschutz` | Datenschutzerklärung (DE) |
| `https://your-app.example/legal/imprint` | Imprint (EN, if seeded) |
| `https://your-app.example/legal/privacy` | Privacy Policy (EN, if seeded) |

→ Footer links are set per app (legal-pages does not ship a footer
component — deliberately, every app has its own layout).

### 5. Editing texts later (TenantAdmin maintenance)

Through the standard write API:

```typescript
await fetch("/api/write", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({
    type: "text-content:write:set",
    payload: { slug: "imprint", lang: "de", title: "Impressum", body: "..." },
  }),
});
```

ACL: `["TenantAdmin", "SystemAdmin"]`. Cache header `public, max-age=300`
— visitors see updates within 5 minutes at most.

## Boot-check behavior

When the required blocks (`imprint/de` + `privacy/de`) are missing
from SYSTEM_TENANT:

| Mode | Behavior |
|---|---|
| `NODE_ENV=production` | App boot throws an error with a slug list — container exits |
| otherwise (dev/test) | `console.warn` with a slug list, app starts anyway |

→ Safety net: no production deploy without populated legal pages.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Route returns `503 legal page unavailable` | `anonymousAccess` not configured in `runProdApp` | Set `anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID }` |
| Boot check throws `ctx.textContent missing` | `extraContext.textContent` not wired | Set `extraContext: ({ db }) => ({ textContent: createTextContentApi(db) })` |
| Route returns `404 not configured` | Required block doesn't exist or has `body=null` | `seedTextBlock` with a body string |
| Multi-tenant app: tenant subdomain shows an empty page | (Bug regression?) Routes should ALWAYS show SYSTEM_TENANT texts | The `legal-pages.integration.ts` test "SYSTEM_TENANT routing" covers this — should be green |
| `<script>` tags in a Markdown body land 1:1 in the HTML | Deliberately accepted right now — see [legal-pages/README.md XSS section](../../../packages/bundled-features/src/legal-pages/README.md#xss--currently-not-secured-by-design) | DOMPurify is a Phase 2 once a multi-author setup arrives |

## Cross-refs

- [packages/bundled-features/src/text-content/README.md](../../../packages/bundled-features/src/text-content/README.md) — generic text module
- [packages/bundled-features/src/legal-pages/README.md](../../../packages/bundled-features/src/legal-pages/README.md) — DACH compliance wrapper
- [docs/plans/datenschutz/](../../../docs/plans/datenschutz/) — consolidated privacy plan index
- [docs/plans/datenschutz/legal-artifacts.md](../../../docs/plans/datenschutz/legal-artifacts.md) — template sources for legally-sound texts

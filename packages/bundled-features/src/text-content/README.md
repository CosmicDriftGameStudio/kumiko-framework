# text-content

Generischer Markdown-Text-Container — pro `(tenantId, slug, lang)`
genau ein Block. Use-Cases: Impressum, Datenschutzerklärung, FAQ,
About, ToS, Marketing-Snippets. Foundation für
[`legal-pages`](../legal-pages/), aber auch standalone nutzbar.

**Opt-in.** Wer keine statischen Texte braucht (interne Tools, reine
API-Apps), aktiviert das Feature gar nicht.

---

## Setup

```typescript
import { createTextContentFeature } from "@kumiko/bundled-features/text-content";

runProdApp({
  features: [createTextContentFeature(), /* ... */],
});
```

### Production-Tabellen-Setup

Pro App wird die `read_text_blocks`-Tabelle via Drizzle-Migration
angelegt:

```bash
# Im App-Workspace (z.B. samples/showcases/myapp):
yarn kumiko migrate generate    # erkennt das neue r.entity("text-block")
                                # → drizzle-Migration im drizzle/-Ordner
yarn kumiko migrate apply       # führt aus (Pre-Deploy-Step in Prod)
```

Boot-Gate (`runProdApp`) prüft hart: fehlende Tabelle = `SchemaDriftError`,
Container exit. Kein Auto-Heal in Production. Siehe
[docs/plans/architecture/migrations.md](../../../../docs/plans/architecture/migrations.md).

In Integration-Tests (vitest) genügt:

```typescript
import { createEntityTable } from "@kumiko/framework/stack";
import { textBlockEntity } from "@kumiko/bundled-features/text-content";

await createEntityTable(stack.db, textBlockEntity);
```

## Use-Cases

text-content ist generisch — alles was statischer Markdown-Text
pro `(tenantId, slug, lang)` ist passt. Beispiele aus der Praxis:

| Slug-Beispiel | Use-Case | Tenant-Scope |
|---|---|---|
| `imprint`, `privacy` | Impressum, Datenschutz (DACH) | SYSTEM_TENANT_ID (app-weit) |
| `terms-of-service`, `eula` | Nutzungsbedingungen | SYSTEM_TENANT_ID oder tenant-eigen |
| `faq-billing`, `faq-onboarding`, `faq-troubleshooting` | FAQ-Sektionen | SYSTEM_TENANT_ID |
| `about-team`, `about-mission` | About-Pages | SYSTEM_TENANT_ID |
| `help-shortcuts`, `help-search` | In-App Help-Texte | SYSTEM_TENANT_ID |
| `welcome-email-body`, `password-reset-body` | Email-Templates (Markdown-Body) | SYSTEM_TENANT_ID oder tenant-Branding |
| `marketing-pricing-cta`, `marketing-feature-list` | Marketing-Snippets für Landing-Pages | SYSTEM_TENANT_ID |
| `tenant-welcome-message` | Tenant-spezifischer Text | TenantId (jeder Tenant pflegt seinen) |

Konvention für Slugs: `kebab-case`, Hierarchie via `bereich-thema`
(z.B. `faq-billing` statt `billing-faq` damit Listen-Aggregation
nach Präfix einfach ist).

---

## API

### `text-content:write:set` — Upsert pro Block

Tenant-Admin schreibt einen Block. Idempotent: existiert bereits
ein Block für `(tenantId, slug, lang)`, wird er aktualisiert.

```typescript
import { TextContentHandlers } from "@kumiko/bundled-features/text-content";

await stack.http.writeOk(TextContentHandlers.set, {
  slug: "imprint",
  lang: "de",
  title: "Impressum",
  body: "## Angaben gemäß § 5 TMG\n\nMarc Frost ...",
}, tenantAdmin);
```

**Validation:**
- `slug` — kebab-case (`/^[a-z0-9][a-z0-9-]*$/`), max 64 Zeichen
- `lang` — ISO 639-1 (`de`, `en`, `en-us`, ...)
- `title` — 1-200 Zeichen
- `body` — Markdown, max 100000 Zeichen, nullable

**Access:** `roles: ["TenantAdmin"]`. Tenant-scope kommt automatisch
aus `event.user.tenantId`. Plattform-Admins (SystemTenant) setzen
Texte via SystemAdmin-Rolle in SYSTEM_TENANT_ID.

### `text-content:query:by-slug` — Public Read

Anonymous-tauglich (`roles: ["anonymous", "User", "TenantAdmin",
"SystemAdmin"]`) — Visitors auf Marketing-/Legal-Pages sollen Texte
sehen ohne Login.

```typescript
import { TextContentQueries } from "@kumiko/bundled-features/text-content";

const block = await stack.http.queryOk(TextContentQueries.bySlug, {
  slug: "imprint",
  lang: "de",
}, anyUser);
// → { slug, lang, title, body, updatedAt } | null
```

**Tenant-Scope:** kommt aus `query.user.tenantId`. Bei anonymous-
Requests muss der Server `anonymousAccess` mit `defaultTenantId`
oder `tenantResolver` konfigurieren.

---

## Test-Helper

```typescript
import { seedTextBlock } from "@kumiko/bundled-features/text-content/seeding";

await seedTextBlock(db, {
  tenantId: SYSTEM_TENANT_ID,
  slug: "imprint",
  lang: "de",
  title: "Impressum",
  body: "...",
});
```

Idempotent: zweiter Aufruf updated den Block.

---

## Cross-Feature-API (für consumer-Features)

Wenn ein anderes Feature (z.B. `legal-pages`) text-blocks lesen will,
**ohne direct code-import**, gibt es eine extraContext-API:

```typescript
import { createTextContentApi, requireTextContent } from "@kumiko/bundled-features/text-content";

// 1. App-Bootstrap wired die API:
runProdApp({
  features: [createTextContentFeature(), createLegalPagesFeature(), /* ... */],
  extraContext: ({ db }) => ({
    textContent: createTextContentApi(db),
  }),
});

// 2. Im consumer-Feature (z.B. legal-pages handler / boot-job):
const textContent = requireTextContent(ctx, "my-handler");
const block = await textContent.getBlock({
  tenantId: SYSTEM_TENANT_ID,
  slug: "imprint",
  lang: "de",
});
```

Pattern symmetrisch zu `config` ↔ `tenant`: `text-content` exportiert
nur Type + Factory, consuming-Features importieren nur den Type. So
kann text-content beliebig refactor werden ohne andere Features zu
brechen — der Vertrag ist die `TextContentApi`-Schnittstelle.

## Mit `legal-pages` kombinieren

`legal-pages` ist ein opt-in-Wrapper der vier feste Convenience-
Routes (`/legal/impressum`, `/legal/datenschutz`, `/legal/imprint`,
`/legal/privacy`) registriert und Markdown→HTML rendered. Siehe
[../legal-pages/README.md](../legal-pages/README.md).

---

## Architektur

- **Single-Source-of-Truth:** `textBlockEntity` in `table.ts`.
  Drizzle-Tabelle wird via `buildDrizzleTable("text-block",
  textBlockEntity)` abgeleitet, der unique-Index auf
  `(tenantId, slug, lang)` ist via `entity.indexes` deklariert.
- **Event-Sourced:** Schreibe-Pfad geht durch
  `createEventStoreExecutor` — `text-block.created` und
  `text-block.updated` landen im Event-Stream, Projection-Row in
  derselben TX. Subscribers (Audit, Search) bekommen die Events.
- **Storage:** ein Block pro `(tenantId, slug, lang)`. SYSTEM_TENANT_ID
  für app-weite Texte, normale TenantId für tenant-eigene.

Cross-Refs: [../../docs/plans/datenschutz/](../../../../docs/plans/datenschutz/) für
das größere Datenschutz-Plan-Bild.

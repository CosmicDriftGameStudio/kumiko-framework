# Recipe: legal-pages + text-content

DACH-Compliance-Stack: zwei opt-in bundled-features verdrahtet zu
auto-rendernden Impressum + Datenschutzerklärung-Pages, mit
Markdown-Authoring und Boot-Check für Pflicht-Inhalte.

**Was die Recipe zeigt:**
- Beide Features in `runProdApp({ features: [...] })` aktivieren
- Pflicht-Wirings: `anonymousAccess` + `extraContext.textContent`
- Initial-Seed der DE-Pflicht-Blocks (Impressum + Datenschutz) für SYSTEM_TENANT
- 5 integration-tests die End-to-End-Verhalten beweisen

## Aufbau

```
samples/recipes/legal-pages/
├── package.json                # workspace deps
├── README.md                   # diese Datei
└── src/
    ├── feature.ts              # die zwei Features re-exportiert für Tests
    └── __tests__/
        └── feature.integration.ts  # 5 Tests: Routes + Boot-Check
```

`feature.ts` ist absichtlich dünn (Re-Export). In einer echten App
landet das in `bin/main.ts` (siehe „Integration in eine echte App"
unten).

## Tests laufen

```bash
# Vom Repo-Root aus:
yarn test:all run samples/recipes/legal-pages/
```

Erwarteter Output:
```
Test Files  1 passed (1)
     Tests  5 passed (5)
```

Wenn Tests grün sind, ist:
- text-content + legal-pages compatibel
- Tabellen-Schema sauber via `createEntityTable(stack.db, textBlockEntity)`
- Routes erreichbar über `stack.app.request("/legal/impressum")`
- Markdown-Render produziert gültiges HTML
- Boot-Check erkennt fehlende Blocks korrekt

## Integration in eine echte App

Schritt-für-Schritt für eine bestehende Kumiko-App (z.B.
`samples/showcases/your-app/`):

### 1. Features in `runProdApp` aktivieren

```typescript
// bin/main.ts
import { runProdApp } from "@kumiko/dev-server";
import {
  createTextContentApi,
  createTextContentFeature,
} from "@kumiko/bundled-features/text-content";
import { createLegalPagesFeature } from "@kumiko/bundled-features/legal-pages";
import { SYSTEM_TENANT_ID } from "@kumiko/framework/engine";

await runProdApp({
  features: [
    createTextContentFeature(),
    createLegalPagesFeature(),
    /* ... deine anderen Features */
  ],
  // Pflicht (1): Routes laufen anonymous, brauchen Tenant-Resolution
  anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  // Pflicht (2): Boot-Check + interner Lookup nutzen ctx.textContent
  extraContext: ({ db }) => ({
    textContent: createTextContentApi(db),
  }),
});
```

→ Bei host-basierten Multi-Tenant-Apps (wie publicstatus.eu) bleibt
`SYSTEM_TENANT_ID` für legal-pages immer korrekt — die Routes setzen
intern `X-Tenant: SYSTEM_TENANT_ID` und überstimmen jeden host-
basierten `tenantResolver`. Das ist die Entscheidung „1 App = X Tenants
= 1 Impressum".

### 2. Tabelle anlegen

```bash
# Im App-Workspace:
yarn kumiko migrate generate    # erkennt text-block-Entity → SQL-Migration
yarn kumiko migrate apply       # einmalig (Pre-Deploy-Step in Prod)
```

### 3. Initial-Seed der Pflicht-Blocks

Eine einmalige Setup-Routine die beim ersten Boot oder via CLI läuft:

```typescript
// bin/seed-legal.ts
import { seedTextBlock } from "@kumiko/bundled-features/text-content/seeding";
import { SYSTEM_TENANT_ID } from "@kumiko/framework/engine";
import { createDb } from "@kumiko/framework/db";

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

→ Vorlagen für vollständige rechtssichere Texte: e-recht24.de
oder datenschutz-generator.de von Dr. Schwenke. Siehe
[docs/plans/datenschutz/legal-artifacts.md](../../../docs/plans/datenschutz/legal-artifacts.md).

### 4. Pages besuchen

Nach dem Seed sind diese URLs sofort live:

| URL | Inhalt |
|---|---|
| `https://your-app.example/legal/impressum` | Impressum (DE) |
| `https://your-app.example/legal/datenschutz` | Datenschutzerklärung (DE) |
| `https://your-app.example/legal/imprint` | Imprint (EN, falls geseedet) |
| `https://your-app.example/legal/privacy` | Privacy Policy (EN, falls geseedet) |

→ Footer-Links pro App selbst setzen (legal-pages liefert keine
Footer-Component — bewusst, jede App hat ihr eigenes Layout).

### 5. Texte später ändern (TenantAdmin-Pflege)

Über die normale Write-API:

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

ACL: `["TenantAdmin", "SystemAdmin"]`. Cache-Header `public, max-age=300`
— Visitors sehen Updates spätestens nach 5 Minuten.

## Boot-Check-Verhalten

Wenn die Pflicht-Blocks (`imprint/de` + `privacy/de`) im SYSTEM_TENANT
fehlen:

| Modus | Verhalten |
|---|---|
| `NODE_ENV=production` | App-Boot wirft Error mit slug-Liste — Container exit |
| sonst (dev/test) | `console.warn` mit slug-Liste, App startet trotzdem |

→ Sicherheits-Netz: kein Production-Deploy ohne befüllte Legal-Pages.

## Troubleshooting

| Symptom | Ursache | Fix |
|---|---|---|
| Route returnt `503 legal page unavailable` | `anonymousAccess` nicht in `runProdApp` konfiguriert | `anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID }` setzen |
| Boot-Check wirft `ctx.textContent missing` | `extraContext.textContent` nicht gewired | `extraContext: ({ db }) => ({ textContent: createTextContentApi(db) })` setzen |
| Route returnt `404 not configured` | Pflicht-Block existiert nicht oder hat `body=null` | `seedTextBlock` mit body-string |
| Multi-Tenant-App: tenant-subdomain zeigt leere Page | (Bug-Regression?) Routes sollten IMMER SYSTEM_TENANT-Texte zeigen | Test in `legal-pages.integration.ts` „SYSTEM_TENANT-routing" prüft das — sollte grün sein |
| `<script>`-Tags im Markdown-Body landen 1:1 im HTML | Bewusst aktuell — siehe [legal-pages/README.md XSS-Sektion](../../../packages/bundled-features/src/legal-pages/README.md#xss--bewusst-aktuell-nicht-gesichert) | DOMPurify als Phase-2 wenn Multi-Author-Setup kommt |

## Cross-Refs

- [packages/bundled-features/src/text-content/README.md](../../../packages/bundled-features/src/text-content/README.md) — generisches Text-Modul
- [packages/bundled-features/src/legal-pages/README.md](../../../packages/bundled-features/src/legal-pages/README.md) — DACH-Compliance-Wrapper
- [docs/plans/datenschutz/](../../../docs/plans/datenschutz/) — konsolidierter Datenschutz-Plan-Index
- [docs/plans/datenschutz/legal-artifacts.md](../../../docs/plans/datenschutz/legal-artifacts.md) — Vorlagen-Quellen für rechtssichere Texte

# legal-pages

Opt-in-Wrapper um [`text-content`](../text-content/) für
DACH-Compliance. Liefert vier feste Public-HTML-Routes
(`/legal/impressum`, `/legal/datenschutz`, `/legal/imprint`,
`/legal/privacy`) mit Markdown→HTML-Rendering und einen Boot-Check
der in Production hart fehlt wenn die DE-Pflicht-Blocks nicht
geseedet sind.

**Opt-in.** Interne Tools, US-Apps ohne Impressums-Pflicht,
Hobby-Projekte ohne Public-Zugriff aktivieren das Feature gar nicht.

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
  // Zwei Wirings sind Pflicht:
  //   1. anonymousAccess für /legal/*-Routes (laufen ohne JWT)
  //   2. extraContext.textContent für den Boot-Check (Cross-Feature-
  //      Decoupling — legal-pages importiert keinen Code aus text-content,
  //      nutzt nur die API über ctx)
  anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  extraContext: ({ db }) => ({
    textContent: createTextContentApi(db),
  }),
});
```

---

### Production-Tabellen-Setup

legal-pages selbst hat keine eigene Tabelle — es nutzt
`text-content`'s `read_text_blocks`. Tabellen-Setup geht also
über text-content:

```bash
yarn kumiko migrate generate    # text-block-Entity wird erkannt
yarn kumiko migrate apply
```

Siehe [text-content/README.md](../text-content/README.md#production-tabellen-setup).

## Routen

| Pfad | Slug + Lang | Title-Fallback (wenn Block leer) |
|---|---|---|
| `GET /legal/impressum` | `imprint` / `de` | "Impressum" |
| `GET /legal/datenschutz` | `privacy` / `de` | "Datenschutzerklärung" |
| `GET /legal/imprint` | `imprint` / `en` | "Imprint" |
| `GET /legal/privacy` | `privacy` / `en` | "Privacy Policy" |

Antwort:
- `200 text/html` — Block existiert + hat body. Cache-Header `public, max-age=300`.
- `404 text/plain` — Block fehlt. Hinweis "Tenant-Admin must set this text-block".
- `503 text/plain` — `app.fetch` zu `/api/query` failed (anonymousAccess fehlt?).

Layout: minimaler HTML5-Skeleton mit Inline-CSS — Apps die das in
ihr eigenes Layout integrieren wollen, nutzen
`text-content:query:by-slug` direkt und rendern selbst.

---

## Boot-Check

`r.job` mit `runOnBoot: true` checkt beim App-Start ob die
DE-Pflicht-Blocks im SYSTEM_TENANT existieren:

| Slug + Lang | Was passiert wenn fehlt |
|---|---|
| `imprint` / `de` | **Production:** `throw new Error(...)` blockt App-Start. **Dev:** `ctx.log.warn(...)` |
| `privacy` / `de` | wie oben |

EN-Versionen sind **nicht** Boot-fail-relevant (`LEGAL_OPTIONAL_BLOCKS`).
Die Routes liefern `404` falls EN-Block fehlt.

→ Apps die das Feature aktivieren müssen vor Production-Deploy die
beiden DE-Blocks seeden — entweder via Bootstrap-Script
(`seedTextBlock`) oder manuell via TenantAdmin-API.

---

## TenantAdmin-Pflege via API

Tenant-Admins (oder Plattform-SystemAdmin für SYSTEM_TENANT-Texte)
können Inhalte jederzeit per Standard-write-Handler aktualisieren:

```typescript
// Aus dem Tenant-Admin-Frontend (oder admin-curl):
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

→ Idempotent: zweiter Call mit gleichem `(slug, lang)` updated den Block.
ACL: `roles: ["TenantAdmin", "SystemAdmin"]` — SystemAdmin (globale Rolle)
darf SYSTEM_TENANT-Texte setzen, TenantAdmin nur Tenant-eigene.

→ Cache-Header der Routes ist `public, max-age=300` — nach Update
sehen Visitors die neuen Inhalte spätestens nach 5 Minuten. Wer
sofortige Sichtbarkeit braucht, kann via CDN-Purge nachhelfen.

## Seeding

Beim ersten App-Boot oder via Migration:

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

Vorlagen für Impressum + Datenschutzerklärung siehe
[docs/plans/datenschutz/legal-artifacts.md](../../../../docs/plans/datenschutz/legal-artifacts.md)
sowie geprüfte externe Generatoren (e-recht24.de,
datenschutz-generator.de).

---

## XSS — bewusst aktuell nicht gesichert

`marked` rendert HTML-Tags 1:1, also kann ein böswilliger
TenantAdmin theoretisch `<script>` in den Body setzen.

Aktuell akzeptiert weil:
- nur `roles: ["TenantAdmin"]` setzen Texte
- Multi-Author-Setups gibt es noch nicht
- Self-Hosted-Tier ohne unbekannte Tenant-Admins

**Phase-2-Hardening:** `DOMPurify` oder `isomorphic-dompurify`
sanitization-step zwischen `marked.parse()` und Response.
Dokumentiert wenn ein Customer mit Multi-Author-Setup auftaucht.

---

## Tenant-Modell

**1 App = X Tenants = 1 Impressum.** Alle Subdomains/Tenant-Hosts
einer Kumiko-App teilen sich die SYSTEM_TENANT-Version der
Legal-Pages. Wer pro-Tenant-Impressums braucht (selten — typischer
Fall: Plattform-Betreiber ist Verantwortlicher, nicht Tenant-Customer),
kann `text-content`'s by-slug-Query direkt mit Tenant-spezifischer
TenantId aufrufen und eigene Routes davorsetzen.

---

## Architektur-Cross-Refs

- [docs/plans/datenschutz/](../../../../docs/plans/datenschutz/)
  — Konsolidierter Datenschutz-Plan-Index
- [docs/plans/datenschutz/legal-artifacts.md](../../../../docs/plans/datenschutz/legal-artifacts.md)
  — Vorlagen + Wo-was-liegt für Impressum/AVV/TOMs/Verarbeitungsverzeichnis
- [docs/plans/datenschutz/compliance-as-product.md](../../../../docs/plans/datenschutz/compliance-as-product.md)
  — Roadmap für Auto-Generation (Sub-Processor-Liste, TOMs, Datenpannen-Workflow)
- [samples/recipes/legal-pages/](../../../../samples/recipes/legal-pages/)
  — Live-Sample mit beiden Features verdrahtet

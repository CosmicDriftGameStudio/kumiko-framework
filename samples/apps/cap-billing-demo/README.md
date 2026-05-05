# Cap-Billing-Demo

Sample-App, die zeigt wie eine Kumiko-App **tier-engine** + **cap-counter** + **mail-foundation Plugin-API** zusammen-verdrahtet, um per-Tenant-Caps auf Newsletter-Sends zu erzwingen — inkl. soft-hit-Notification und hard-block.

Das Sample ist gleichzeitig die **lebende Doku** für das Pattern: lese den Code von oben nach unten und du hast die Cap-Engine verstanden.

## Was die Demo macht

Eine kleine Newsletter-App mit zwei Tiers:

| Tier | Newsletter pro Monat | Soft-Warning bei | Hard-Block bei |
|------|-----------|-------------------|-----------------|
| free | 10 | 11 (110%) | 12 (120%) |
| pro | 100 | 110 (110%) | 120 (120%) |

Mails landen in einem **In-Memory-Transport** (`mail-transport-inmemory`). Es gibt keinen echten SMTP-Server — perfekt für die Demo, kein Mailpit/Mailcrab nötig. Die Inbox wird per Helper-Funktion ausgelesen.

## Architektur in 4 Schichten

```
┌──────────────────────────────────────────────────────────────┐
│ src/feature.ts                                               │
│   newsletter:write:send (cap-aware)                          │
│   ├── inner-handler: createTransportForTenant + .send()      │
│   └── wrapper: withCapEnforcement                            │
│       ├── pre: enforceCapAndMaybeNotify(tier-bedingt)        │
│       │     └── notifier: sendet Warning-Mail an Admin       │
│       └── post: incrementCap (+1)                            │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ src/tier-map.ts                                              │
│   DEMO_TIER_MAP: Record<TierName, {features, caps}>          │
│   resolveTier(ctx) → 1. subscription-row (Provider-Webhook)  │
│                      2. config "newsletter:config:tier"      │
│                      3. default "free"                       │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ src/run-config.ts                                            │
│   APP_FEATURES = [secrets, cap-counter, mail-foundation,     │
│                   mail-transport-inmemory,                   │
│                   billing-foundation, newsletter]       │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ bundled-features (kein Code in der App)                      │
│   tier-engine: composeApp + TierMap-Type                     │
│   cap-counter: enforceCap + withCapEnforcement + counter-ES  │
│   mail-foundation: Plugin-API für Transports                 │
│   mail-transport-inmemory: per-tenant in-memory Inbox        │
│   billing-foundation: Provider-Plugin-Host (Stripe/     │
│                            Mollie). Demo mountet keine       │
│                            Provider — Tests rufen process-   │
│                            event direkt; eigene App ergänzt  │
│                            createSubscriptionStripeFeature() │
└──────────────────────────────────────────────────────────────┘
```

## Demo-Story als Test

Die kompletteste Doku der Demo ist der Integration-Test selbst:

```bash
yarn vitest run --config vitest.integration.config.ts samples/apps/cap-billing-demo
```

`src/__tests__/cap-billing-demo.integration.ts` fährt den vollen
Dispatcher + DB hoch und beweist Schritt-für-Schritt:

- 10 Newsletter senden ohne Warning
- 12. Newsletter triggered einmalig die Soft-Hit-Notification
- 13. Newsletter wird hart geblockt (CapExceededError)
- Pro-Tenant nicht von Free-Tenant's Cap betroffen
- **Tier-Wechsel mid-period:** free→pro upgrade lässt counter
  intakt + nutzt sofort den höheren Cap (= echter Stripe-Webhook-
  Pfad). pro→free downgrade blockiert sofort wenn counter über dem
  neuen hard-limit liegt.

Lies die Test-Datei oben-nach-unten — sie ist als living-doc geschrieben.

## Lokal laufen lassen

```bash
yarn kumiko dev      # Postgres + Redis hochfahren
yarn install
cd samples/apps/cap-billing-demo
yarn dev             # → http://localhost:4290
```

| Login | Wert |
|-------|------|
| URL | `http://localhost:4290` |
| Email | `admin@cap-demo.local` |
| Passwort | `changeme` |
| Tenant | "Cap-Billing-Demo" |

Im Browser kannst du via Designer/Admin-UI den config-key
`newsletter:config:tier` auf `"free"` oder `"pro"` setzen und den
`newsletter:write:send`-Handler triggern. Die "versendeten" Mails
landen in `getInbox(tenantId)` aus
`@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory` — es gibt keinen
HTTP-Endpoint dafür, weil das Sample die Architektur zeigt, nicht
ein Inbox-UI.

Wer's klick-bar will: schreib einen kleinen `r.queryHandler("inbox:
list")` der `getInbox(ctx.user.tenantId)` returnt. ~20 LOC,
absichtlich nicht im Sample drin um den Fokus auf cap+tier zu
halten.

## Wie übertrage ich das auf eine echte App?

Das Sample ist absichtlich minimal. Für eine Production-App tausche:

| Demo-Komponente | Production-Ersatz |
|-----------------|-------------------|
| `mail-transport-inmemory` | `mail-transport-smtp` (BYOK) oder ein selbst gebautes Plugin |
| Hardcoded `DEMO_TIER_MAP` | bleibt — Tier-Definitionen sind statisch, der subscription-row schreibt nur den `tier`-Schlüssel |
| Tier-Switch via Webhook (test-only) | Mount eines echten Plugins: `createSubscriptionStripeFeature(...)` und/oder `createSubscriptionMollieFeature(...)` in der run-config |
| 2 Tiers (free/pro) | beliebige Anzahl, siehe `samples/apps/platform/src/tier-map.ts` für 4-Tier-Beispiel |
| Newsletter-domain | dein eigenes Feature mit `withCapEnforcement(handler, capResolver)` |

Der **Plugin-API-Switch** zwischen demo + production ist ein einziges Konfig-Wert: `mail-foundation:config:provider` wechselt von `"inmemory"` auf `"smtp"`, kein Code-Refactor.

## Schlüssel-Dateien

- **`src/feature.ts`** — der gewrappte send-Handler. Hier siehst du wie `withCapEnforcement` einen normalen Handler in einen cap-aware-Handler verwandelt
- **`src/tier-map.ts`** — DEMO_TIER_MAP + Tier-Namen-Whitelist
- **`src/run-config.ts`** — Feature-Komposition (welche bundled-features die Demo mountet)
- **`src/__tests__/cap-billing-demo.integration.ts`** — durchgespielte Story (10/11/12/13 Newsletter, soft+hard transitions, tenant-isolation)

## Fragen / Schwächen die diese Demo offenlegt

Das Sample ist als Doku-Test gedacht. Konkrete Schwächen die wir hier sehen:

- **Notifier-Adresse hardcoded.** `buildSoftHitNotifier` in `feature.ts` schickt an `admin@tenant-${id.slice(-4)}.demo`. Echte App würde tenant-config oder users-Tabelle abfragen.
- **Tier-Lookup pro send-call.** Die `resolveTier(ctx)`-Funktion macht eine DB-Query auf die subscription-row bei jedem Send — bei busy Tenants wäre Caching sinnvoll. Demo lässt das raus weil's vom Cap-Pattern ablenkt.
- **Kein Provider-Mount in der Demo selbst.** Die Tests rufen `billing-foundation:write:process-event` direkt; in Production mountet die App `createSubscriptionStripeFeature(...)` oder `createSubscriptionMollieFeature(...)` und Mollie/Stripe-Webhooks treffen `/api/subscription/webhook/:providerName`.

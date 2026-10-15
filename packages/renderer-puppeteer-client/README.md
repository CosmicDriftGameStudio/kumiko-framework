# renderer-puppeteer-client

Plugin für `renderer-foundation`. Rendert `kind=["document-pdf", "image-snapshot"]`-Requests via HTTP-Call gegen `puppeteer-service` (separate app in `apps/puppeteer-service` of this repository).

**Plan-Doc:** [`renderer-foundation.md`](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/features/renderer-foundation.md) Schritte 4–7.

## Architektur

```
Caller (z.B. Solon NKA-PDF-Generator)
   │
   │ const renderer = foundation.createRendererForTenant({ tenantId, kind: "document-pdf" })
   │ await renderer.render({ kind: "document-pdf", payload: { content: "<html>…" } }, ctx)
   ▼
renderer-puppeteer-client (DIESES Package)
   │
   │ POST {PUPPETEER_SERVICE_URL}/render
   │ Authorization: Bearer {PUPPETEER_AUTH_TOKEN}
   │ Retry: 5xx + network-error (exponential backoff)
   ▼
puppeteer-service (separate App, K8s-Deployment)
   │
   │ Launches Puppeteer-Browser, rendert HTML
   ▼
{kind: "document-pdf", pdfBytes, ...}
```

## Mount

```typescript
import { createRendererPuppeteerClientFeature } from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";

const features = [
  createRendererFoundationFeature(),
  createRendererPuppeteerClientFeature(),
  // weitere renderer-Plugins (renderer-mail-html, …)
];

// In createKumikoApp's extraContext:
extraContext: ({ db, registry }) => ({
  rendererFoundation: createRendererFoundationApi(collectRendererPlugins(registry)),
});
```

## Konfiguration (env-vars)

App-wide, gesetzt via K8s-Secret + ConfigMap:

| Var | Default | Beschreibung |
|---|---|---|
| `PUPPETEER_SERVICE_URL` | `http://puppeteer-service:3000` | Cluster-internal URL des Services |
| `PUPPETEER_AUTH_TOKEN` | **required** | Shared Secret (>=16 chars, matched zum Service) |
| `PUPPETEER_CLIENT_TIMEOUT_MS` | `60000` | Per-Request Timeout (Client-Side) |
| `PUPPETEER_CLIENT_MAX_RETRIES` | `3` | Anzahl Retries bei 5xx/network-Error |

**Pro Tenant?** Aktuell **nicht** — alle Tenants nutzen den gleichen Service. Per-tenant-overrides via config-Bundle kommen, wenn der Bedarf real ist (z.B. dedicated puppeteer-pool für Enterprise-Tenants).

## Retry-Strategie

| Response | Aktion |
|---|---|
| `2xx` | Success — bytes returnen |
| `4xx` (Validation, Auth, 413) | **KEIN Retry** — RendererError("invalid_payload") sofort |
| `5xx` (Render-Error, Service-Crash) | Retry mit exponential backoff (200ms × 2^attempt) + ±50% jitter |
| Network-error (ECONNREFUSED, timeout) | Retry wie 5xx |

Nach `PUPPETEER_CLIENT_MAX_RETRIES`-Exhaustion: `RendererError("other")` mit Original-Error-Message.

## Caller-Pattern

```typescript
import { requireRendererFoundation } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";

async function generatePdf(ctx, tenantId, htmlContent) {
  const foundation = requireRendererFoundation(ctx, "generatePdf");
  const renderer = foundation.createRendererForTenant({ tenantId, kind: "document-pdf" });

  const result = await renderer.render(
    {
      kind: "document-pdf",
      payload: { content: htmlContent },
      options: { format: "A4", marginMm: { top: 15, bottom: 15 } },
    },
    { db: ctx.db, registry: ctx.registry, tenantId },
  );

  if (result.kind !== "document-pdf") throw new Error("unexpected kind");
  return result.pdfBytes; // → S3-upload oder direkt zum Caller
}
```

## Tests

- **15 Unit-Tests** (Config + HTTP-Client + Render + Contract) — kein echter Network-Call, fetch-mock via `vi.stubGlobal`.
- **Kein Integration-Test mit echtem Service** — der Service-Stack braucht puppeteer-service running auf einer URL, das ist E2E-Setup (Schritt 7). Hier nur Unit-Coverage des HTTP-Layers.

## Out-of-Scope

- HTML-Sanitization — Caller liefert trusted HTML (kommt aus template-resolver mit tenant-scoping)
- File-Storage — Response ist immer inline bytes, Caller persistiert in S3 wenn nötig
- Tenant-Specific-URLs — derzeit app-wide, später via config-Bundle möglich

# renderer-puppeteer-client

Plugin for `renderer-foundation`. Renders `kind=["document-pdf", "image-snapshot"]` requests via an HTTP call to `puppeteer-service` (separate app in `apps/puppeteer-service` in this repository).

## Architecture

```
Caller (e.g. Solon NKA-PDF-Generator)
   │
   │ const renderer = foundation.createRendererForTenant({ tenantId, kind: "document-pdf" })
   │ await renderer.render({ kind: "document-pdf", payload: { content: "<html>…" } }, ctx)
   ▼
renderer-puppeteer-client (THIS package)
   │
   │ POST {PUPPETEER_SERVICE_URL}/render
   │ Authorization: Bearer {PUPPETEER_AUTH_TOKEN}
   │ Retry: 5xx + network-error (exponential backoff)
   ▼
puppeteer-service (separate app, K8s deployment)
   │
   │ Launches Puppeteer browser, renders HTML
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
  // additional renderer plugins (renderer-mail-html, …)
];

// In createKumikoApp's extraContext:
extraContext: ({ db, registry }) => ({
  rendererFoundation: createRendererFoundationApi(collectRendererPlugins(registry)),
});
```

## Configuration (env vars)

App-wide, set via K8s Secret + ConfigMap:

| Var                            | Default                         | Description                                      |
| ------------------------------ | ------------------------------- | ------------------------------------------------ |
| `PUPPETEER_SERVICE_URL`        | `http://puppeteer-service:3000` | Internal cluster URL of the service              |
| `PUPPETEER_AUTH_TOKEN`         | **required**                    | Shared secret (>=16 chars, matching the service) |
| `PUPPETEER_CLIENT_TIMEOUT_MS`  | `60000`                         | Per-request timeout (client side)                |
| `PUPPETEER_CLIENT_MAX_RETRIES` | `3`                             | Number of retries for 5xx/network errors         |

**Per tenant?** Currently **no**. All tenants use the same service. Per-tenant overrides via a config bundle will be added when there is a real need, for example a dedicated Puppeteer pool for enterprise tenants.

## Retry strategy

| Response                              | Action                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| `2xx`                                 | Success, return bytes                                               |
| `4xx` (validation, auth, 413)         | **NO retry**. Return `RendererError("invalid_payload")` immediately |
| `5xx` (render error, service crash)   | Retry with exponential backoff (200ms × 2^attempt) + ±50% jitter    |
| Network-error (ECONNREFUSED, timeout) | Retry as for 5xx                                                    |

After `PUPPETEER_CLIENT_MAX_RETRIES` is exhausted: `RendererError("other")` with the original error message.

## Caller pattern

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
  return result.pdfBytes; // → S3 upload or directly to the caller
}
```

## Tests

- **15 unit tests** (config + HTTP client + render + contract). No actual network call, fetch mocked via `vi.stubGlobal`.
- **No integration test with a real service**. The service stack requires puppeteer-service to be running at a URL, which is an E2E setup (step 7). Here, only unit coverage of the HTTP layer.

## Out of scope

- HTML sanitization: the caller provides trusted HTML (from template-resolver with tenant scoping)
- File storage: the response always contains inline bytes, and the caller persists them to S3 if necessary
- Tenant-specific URLs: currently app-wide, possibly via a config bundle later

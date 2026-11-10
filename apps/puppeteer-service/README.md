# puppeteer-service

HTTP-Service für PDF + Image-Rendering via Puppeteer. Wird von `renderer-puppeteer-client` (Plugin in `packages/renderer-puppeteer-client`) konsumiert.

**Standalone Bun.serve-App.** Läuft als separates K8s-Deployment, isoliert von Apps (Chrome-Memory-Footprint + crash-recovery).

## API

### `POST /render`

```jsonc
// Request:
{
  "kind": "document-pdf",          // oder "image-snapshot"
  "html": "<html>...</html>",
  "options": { "format": "A4", "marginMm": { "top": 10, "bottom": 10 } }
}
```

Der Service lädt keine http(s)-Ressourcen (Egress-Guard). Das HTML muss alle Ressourcen als `data:`-URIs einbetten, auch bei `image-snapshot`; externe `<img>`/`<link>` werden verworfen.

```
Authorization: Bearer <PUPPETEER_AUTH_TOKEN>
Content-Type: application/json
```

**Response:**
- `200`: binary bytes mit korrektem `Content-Type` (`application/pdf`, `image/png`, `image/jpeg`)
- `400 invalid_payload`: malformed JSON oder schema-violation
- `401 unauthorized`: Token missing/falsch
- `413 html_too_large` / `payload_too_large`: HTML überschreitet `MAX_HTML_BYTES`
- `500 render_failed`: Puppeteer-Error
- `504 render_failed` (timeout-keyword): Render hat `RENDER_TIMEOUT_MS` überschritten

### `POST /rasterize`

Macht aus einem PDF PNG-Seiten (poppler: `pdftoppm`, optional `pdfimages`), damit ein Agent das Ergebnis sehen kann. Gleiche Auth und gleicher Concurrency-Zähler wie `/render`.

**Request (JSON):** `{ pdfBase64, maxPages?, dpi?, images? }`. `maxPages` höchstens `MAX_RASTER_PAGES`, `dpi` 72, 100 (Default) oder 150, `images: true` liefert zusätzlich die eingebetteten Bilder (höchstens 20).

**Response:** `200 { pages: [{ mimeType, data, widthPx, heightPx }], images: [...] }` (`data` ist Base64). `400 invalid_pdf`, `400 invalid_payload`, `401`, `413 payload_too_large` / `pdf_too_large` / `result_too_large`, `503 busy`, `504 rasterize_failed` (Timeout `RENDER_TIMEOUT_MS`).

### `GET /healthz`

K8s liveness/readiness probe. Returnt `200 "ok"`. Kein Auth.

### `GET /metrics`

Prometheus-text-format. Kein Auth — relies on K8s NetworkPolicy.

`puppeteer_browser_running` ist 1, solange Chromium läuft, und 0 nach dem Idle-Close.

```
puppeteer_renders_total{kind="document-pdf"} 42
puppeteer_renders_total{kind="image-snapshot"} 7
puppeteer_render_errors_total 0
puppeteer_render_duration_ms_mean 1240
puppeteer_browser_running 1
```

## Egress: keine Netzabrufe

Der Service lädt nichts aus dem Netz. Erlaubt sind nur `data:`, `about:` und `blob:`; jede andere Anfrage der Seite (http, https, file, ws, ...) wird abgebrochen. Der Client bettet Bilder deshalb als `data:`-URI ein. Ohne Netzabrufe gibt es kein DNS-Rebinding und keine erreichbaren Node-IPs, Kubelet oder NodePorts; eine NetworkPolicy kann Loopback nicht sperren, der Guard schon.

## Configuration (env-vars)

| Var | Default | Beschreibung |
|---|---|---|
| `PORT` | `3000` | HTTP-Listen-Port |
| `PUPPETEER_AUTH_TOKEN` | **required** | Shared Secret mit Plugin (>=16 chars) |
| `RENDER_TIMEOUT_MS` | `30000` | Per-Render-Timeout |
| `MAX_HTML_BYTES` | `2000000` | Maximum HTML-Größe (2 MB default) |
| `MAX_PDF_BYTES` | `10000000` | Maximale PDF-Größe für `/rasterize` (10 MB default) |
| `MAX_RASTER_PAGES` | `5` | Maximale Seitenzahl, die `/rasterize` pro Aufruf rendert |
| `BROWSER_IDLE_TIMEOUT_MS` | `300000` | Chromium wird nach so vielen ms ohne Render geschlossen (spart ~460 MiB RAM im Leerlauf); der nächste Render startet ihn neu und zahlt den Kaltstart |
| `PUPPETEER_EXECUTABLE_PATH` | undefined | Custom Chromium-Pfad (z.B. system-chromium statt prebuilt) |

**Tier-Profile** (gesetzt via Helm-Values pro Deployment):

```yaml
# basic: strict-Limits
RENDER_TIMEOUT_MS: "10000"
MAX_HTML_BYTES: "500000"

# growth: defaults
RENDER_TIMEOUT_MS: "30000"
MAX_HTML_BYTES: "2000000"

# scale: loose
RENDER_TIMEOUT_MS: "60000"
MAX_HTML_BYTES: "10000000"
```

K8s `resources.limits.memory` wird parallel pro Tier gesetzt (basic 512Mi, growth 1Gi, scale 2Gi). Service selbst hat keinen internen Memory-Cap — OOM-Kill via K8s ist intended.

## Local-Dev

```bash
PUPPETEER_AUTH_TOKEN=$(openssl rand -hex 32) bun run src/index.ts
```

Smoke-Test:

```bash
curl -fsS -X POST http://localhost:3000/render \
  -H "Authorization: Bearer $PUPPETEER_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"document-pdf","html":"<h1>Hello</h1>"}' \
  -o /tmp/test.pdf
open /tmp/test.pdf
```

## Docker

```bash
docker build -t puppeteer-service:dev -f apps/puppeteer-service/Dockerfile .
docker run -p 3000:3000 -e PUPPETEER_AUTH_TOKEN=dev-token-0123456789abcdef puppeteer-service:dev
```

Image-Größe ~280 MB (debian-slim base + chromium + node-modules).

## Crash-Recovery

Service hält **einen long-running Browser** pro Pod. Pages werden pro Render-Call erstellt + geschlossen. Wenn Chromium stirbt (OOM-kill durch K8s, segfault), wird beim nächsten `/render` automatisch neu launched.

## Out-of-Scope

- Authentication-Provider-Integration (OAuth, OIDC) — Bearer-Token reicht für internal-only-Service
- File-Storage (S3-pre-signed-URLs) — Response ist immer inline bytes; Caller persistiert wenn nötig
- Multi-Tenant-Quotas — Tier-Limits sind Deployment-bound, nicht request-bound
- HTML-Sanitization — Caller (renderer-puppeteer-client) muss Tenant-HTML als trusted behandeln (kommt aus template-resolver)

## Plan-Doc

[`kumiko-platform/docs/plans/features/renderer-foundation.md`](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/features/renderer-foundation.md) — Schritte 4-6.

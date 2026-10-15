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

### `GET /healthz`

K8s liveness/readiness probe. Returnt `200 "ok"`. Kein Auth.

### `GET /metrics`

Prometheus-text-format. Kein Auth — relies on K8s NetworkPolicy.

```
puppeteer_renders_total{kind="document-pdf"} 42
puppeteer_renders_total{kind="image-snapshot"} 7
puppeteer_render_errors_total 0
puppeteer_render_duration_ms_mean 1240
```

## Configuration (env-vars)

| Var | Default | Beschreibung |
|---|---|---|
| `PORT` | `3000` | HTTP-Listen-Port |
| `PUPPETEER_AUTH_TOKEN` | **required** | Shared Secret mit Plugin (>=16 chars) |
| `RENDER_TIMEOUT_MS` | `30000` | Per-Render-Timeout |
| `MAX_HTML_BYTES` | `2000000` | Maximum HTML-Größe (2 MB default) |
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

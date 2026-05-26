# Docker Deployment — Minimalist

Template for the production deploy of a Kumiko-based app into a single
container. External services (Postgres, Redis, Meilisearch, S3) are
expected to come from managed providers.

## Files

| File | Purpose |
|-------|-------|
| `Dockerfile` | Multi-stage Bun image, non-root, HEALTHCHECK on `/health` |
| `compose.prod.yml` | Reference compose file for a single app container |
| `../.dockerignore` | Keeps tests, docs, samples, and local secrets out of the image |

## Build & Run

```bash
# Build (from repo root)
docker build -f docker/Dockerfile -t my-kumiko-app .

# Run via compose
cp .env.prod.example .env.prod   # fill in values
docker compose -f docker/compose.prod.yml --env-file .env.prod up -d
```

## Minimum env vars to boot

```
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://user:pass@host:6379
JWT_SECRET=<32+ random bytes, base64>
ENCRYPTION_KEY=<32 bytes base64, for encrypted:true fields>
KUMIKO_SECRETS_MASTER_KEY_V1=<32 bytes base64>
KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION=1

# Optional (when feature is used):
MEILI_URL=https://...
MEILI_MASTER_KEY=...
FILE_STORAGE_PROVIDER=s3
S3_ENDPOINT=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

## Per-app adaptations

1. **Entry point** — set `APP_ENTRY` in `compose.prod.yml` (or as a
   build arg). Default: `src/main.ts`.
2. **Workspace manifests** — if your app is part of a Bun workspace,
   uncomment the `COPY packages/*/package.json` block in the Dockerfile.
3. **Port** — hardcoded to 3000. Adjust `EXPOSE` + `HEALTHCHECK` if
   your server listens on a different port.
4. **Build-time secrets** — the image only contains what `.dockerignore`
   lets through. After the first build, verify no `.env` file ended up
   inside: `docker run --rm my-kumiko-app find /app -name '.env*'`

## What this template does NOT do

- **Bundle Postgres/Redis/Meilisearch.** For self-hosting see
  `../docker-compose.yml` (dev) — that needs to be extended with
  restart policies, volumes, and a backup strategy for prod (ops team's
  job).
- **TLS termination.** A reverse proxy in front is expected (Cloudflare,
  Fly.io proxy, Traefik, Caddy).
- **K8s manifests.** The Dockerfile lifts cleanly into a K8s deployment,
  but Helm charts / manifests are out of scope for the Minimalist
  template.

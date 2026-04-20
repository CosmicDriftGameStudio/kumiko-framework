# Docker Deployment — Minimalist

Template fuer den Prod-Deploy einer Kumiko-basierten App in einen einzigen
Container. Externe Services (Postgres, Redis, Meilisearch, S3) werden von
Managed-Providern uebernommen.

## Files

| Datei | Zweck |
|-------|-------|
| `Dockerfile` | Multi-Stage Bun-Image, Non-Root, HEALTHCHECK auf `/health` |
| `compose.prod.yml` | Referenz-Compose fuer einen einzelnen App-Container |
| `../.dockerignore` | Haelt Tests, Docs, Samples, Local-Secrets aus dem Image |

## Build & Run

```bash
# Build (aus Repo-Root)
docker build -f docker/Dockerfile -t my-kumiko-app .

# Run via compose
cp .env.prod.example .env.prod   # Werte eintragen
docker compose -f docker/compose.prod.yml --env-file .env.prod up -d
```

## Minimale Env-Vars fuer den Boot

```
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://user:pass@host:6379
JWT_SECRET=<32+ random bytes, base64>
ENCRYPTION_KEY=<32 bytes base64, fuer encrypted:true Felder>
KUMIKO_SECRETS_MASTER_KEY_V1=<32 bytes base64>
KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION=1

# Optional (wenn Feature verwendet):
MEILI_URL=https://...
MEILI_MASTER_KEY=...
FILE_STORAGE_PROVIDER=s3
S3_ENDPOINT=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

## Adaptionen pro App

1. **Entry-Point** — setze `APP_ENTRY` in `compose.prod.yml` (oder als
   Build-Arg). Default: `src/main.ts`.
2. **Workspace-Manifeste** — wenn deine App Teil eines Yarn-Workspaces ist,
   kommentiere den `COPY packages/*/package.json`-Block im Dockerfile ein.
3. **Port** — hart auf 3000. Aendere `EXPOSE` + `HEALTHCHECK` wenn dein
   Server auf anderem Port lauscht.
4. **Build-Time-Secrets** — das Image enthaelt NUR das was `.dockerignore`
   durchlaesst. Pruefe nach erstem Build, dass keine `.env`-Datei drin
   gelandet ist: `docker run --rm my-kumiko-app find /app -name '.env*'`

## Was dieses Template NICHT macht

- **Postgres/Redis/Meilisearch mit-starten.** Fuer Self-Hosting siehe
  `../docker-compose.yml` (Dev) — das ist mit Restart-Policies + Volumes +
  Backup-Strategie fuer Prod zu erweitern (Aufgabe des Ops-Teams).
- **TLS-Terminierung.** Erwartet einen Reverse-Proxy davor (Cloudflare,
  Fly.io-Proxy, Traefik, Caddy).
- **K8s-Manifeste.** Das Dockerfile laesst sich in ein K8s-Deployment
  heben, aber Helm-Chart / Manifeste sind nicht Teil des Minimalist-Scopes.

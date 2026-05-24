# syntax=docker/dockerfile:1.23
#
# Template-Dockerfile fuer eine Kumiko-basierte App.
# Das Framework selbst wird nicht containerisiert — dies ist die Vorlage,
# die eine darauf aufbauende App (eigener main.ts / server.ts) uebernimmt.
#
# Adaptions-Stellen:
#   - APP_ENTRY (siehe ARG unten)           — Pfad zu deinem Server-Entry
#   - Workspace-Manifeste im deps-Stage     — wenn Monorepo
#   - EXPOSE + HEALTHCHECK port              — wenn nicht 3000
#
# Build:   docker build -f docker/Dockerfile -t my-kumiko-app .
# Run:     docker run -p 3000:3000 --env-file .env.prod my-kumiko-app

ARG BUN_VERSION=1.1.38
ARG APP_ENTRY=src/main.ts
# APP_MODE wird nicht in den Build eingebrannt — Runtime-Env. Sinnvolle
# Werte: "api" (HTTP-only, kein Dispatcher/Jobs), "worker" (kein HTTP,
# EventDispatcher + Jobs), "all-in-one" (beides, fuer Dev/Single-Instance).
# Die App's main.ts wertet process.env.APP_MODE aus und waehlt die
# passende Entrypoint-Factory. Siehe `docs/plans/architecture/scaling.md`.

# ------------------------------------------------------------------------------
# deps — install production dependencies only. Cached separately from source so
# source-only changes don't bust the install layer.
# ------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
# Workspace-Manifeste: wenn deine App ein Workspace-Member ist, kopiere die
# package.json jedes Workspaces BEVOR `bun install` laeuft, damit Bun den Graph
# aufloesen kann. Beispiel:
#   COPY packages/*/package.json packages/
#   COPY app/package.json app/
RUN bun install --frozen-lockfile --production

# ------------------------------------------------------------------------------
# runtime — schlankes Image mit Non-Root-User + HEALTHCHECK.
# ------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
ARG APP_ENTRY
WORKDIR /app

# wget liegt im bun-alpine-Image schon drin; nur noch Non-Root-User anlegen.
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app . .

USER app
ENV NODE_ENV=production
ENV PORT=3000
ENV APP_ENTRY=${APP_ENTRY}
# Default-Mode = all-in-one. Fuer prod-Splits ueberschreibt das der
# Orchestrator pro Deployment: `APP_MODE=api` fuer die API-Replica-Gruppe,
# `APP_MODE=worker` fuer den Event-Dispatcher + Job-Worker.
ENV APP_MODE=all-in-one

EXPOSE 3000

# /health ist der Framework-Liveness-Endpoint (siehe api/server.ts). Fuer
# Readiness (DB/Redis-Ping) nutzt du /health/ready — das ist Welle 1.4.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider "http://127.0.0.1:${PORT}/health" || exit 1

# `exec` hebelt den shell-Prozess ab: bun ersetzt sh als PID 1, SIGTERM
# vom Docker-Daemon kommt also direkt bei bun an → Graceful-Shutdown via
# lifecycle.drain() funktioniert. Ohne `exec` waere sh der PID-1-Empfaenger
# und bun nur ein Child, das SIGTERM nie sieht — 10s spaeter holt Docker
# SIGKILL, in-flight Requests sterben mittendrin.
CMD ["sh", "-c", "exec bun run ${APP_ENTRY}"]

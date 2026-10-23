# Single-stage Bun image mit System-Chromium für PDF + Image-Rendering.
# Base: debian-slim (glibc) + chromium + node-modules.
#
# **Warum nicht alpine:** chromium needs glibc; alpine = musl. Debian-slim
# ist die kleinste-glibc-base mit chromium-Support.
#
# **Bun-Version:** 1.4.0 — gepinnt auf die Version, gegen die CI testet
# (ci.yml). Kein Runtime-Drift gegenüber Test/Build mehr.
#
# **Warum kein build-stage / kein --frozen-lockfile:** puppeteer-service ist
# eine standalone Bun-App mit nur public-npm-Deps (hono/puppeteer/zod), null
# workspace:*-Refs → isolierter `bun install --production` gegen das schmale
# App-package.json. Kein Registry-Token, keine Workspace-Layout-Abhängigkeit.
# Caret-Resolve matched die Runtime-Install-Norm der anderen Deploy-Images
# (studio/publicstatus machen im runtime ebenfalls `bun install --production`).
#
# **Memory:** K8s setzt resources.limits.memory pro Tier-Deployment (basic
# 512Mi, growth 1Gi, scale 2Gi). Service hat keinen internen Memory-Cap —
# OOM-Kill durch K8s ist intended (Pod-restart-policy: Always).

FROM oven/bun:1.4.4-slim AS runtime

# Chromium-Dependencies für Headless-Betrieb. System-chromium (debian-package)
# statt Puppeteer's prebuilt Chrome for Testing — letzteres ist x86_64-only
# (LINUX_ARM-platform mapped trotzdem auf "linux64"-binary). Auf ARM64-Runnern
# (cdgs-runner, OrbStack auf Apple Silicon) wäre Puppeteer's prebuilt nicht
# ausführbar.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Non-root user (chromium braucht das mit --no-sandbox-flag).
# UID/GID 10001 explizit gepinnt — muss mit dem securityContext des Deployments
# (puppeteer-service.ts runAsUser/runAsGroup/fsGroup: 10001) übereinstimmen,
# sonst gehört /home/puppeteer + /app bei einem Base-Image-Bump einer anderen
# UID und Chromium kann das Profile-Dir nicht schreiben → Pod nie ready.
# Nicht 997: Debian Trixie belegt GID/UID 997 bereits mit systemd-timesync
# → groupadd exit 4 beim Docker-Build.
RUN groupadd -g 10001 puppeteer && useradd -u 10001 -g puppeteer -G audio,video -d /home/puppeteer -m puppeteer \
    && mkdir -p /home/puppeteer/Downloads /app \
    && chown -R puppeteer:puppeteer /home/puppeteer /app

WORKDIR /app

# Deps-Layer zuerst (Docker-Layer-Cache): nur das App-package.json kopieren,
# dann production-install. Puppeteer's postinstall-Chromium-Download wird
# geskippt — wir nutzen System-chromium (siehe PUPPETEER_EXECUTABLE_PATH).
# devDependencies droppen: package.json enthält workspace:* für Integration-
# Tests — Bun validiert die auch bei --production, obwohl kein Workspace-Root
# im Image existiert.
COPY --chown=puppeteer:puppeteer apps/puppeteer-service/package.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN bun -e "const f='./package.json'; const p=JSON.parse(await Bun.file(f).text()); delete p.devDependencies; await Bun.write(f, JSON.stringify(p, null, 2));" \
    && bun install --production

COPY --chown=puppeteer:puppeteer apps/puppeteer-service ./apps/puppeteer-service

USER 10001

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:3000/healthz || exit 1

CMD ["bun", "run", "apps/puppeteer-service/src/index.ts"]

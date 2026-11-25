# Single-stage Bun image mit System-Chromium für PDF + Image-Rendering.
# Base: debian-slim (glibc) + chromium + node-modules.
#
# **Warum nicht alpine:** chromium needs glibc; alpine = musl. Debian-slim
# ist die kleinste-glibc-base mit chromium-Support.
#
# **Bun version:** base tag 1.4.5 matches setup-bun 1.4.5 in ci.yml.
#
# **Install:** seeded from the repo bun.lock (like the app images) and run frozen, so transitive
# dependencies stay on the tested versions with integrity hashes. See src/seed-lockfile.ts.
#
# **Memory:** K8s setzt resources.limits.memory pro Tier-Deployment (basic
# 512Mi, growth 1Gi, scale 2Gi). Service hat keinen internen Memory-Cap —
# OOM-Kill durch K8s ist intended (Pod-restart-policy: Always).

# bun aborts under QEMU, so the install runs on the build host for the target CPU. --ignore-scripts keeps host-arch lifecycle builds out of the image.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.5-slim AS deps
ARG TARGETARCH
WORKDIR /app
COPY apps/puppeteer-service/package.json bun.lock apps/puppeteer-service/src/seed-lockfile.ts ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
# The lockfile-only run deliberately has no reachable proxy: a dependency missing from the repo
# lock fails the build instead of resolving fresh. The frozen install then fetches exactly the
# locked tarballs and verifies their integrity.
RUN bun seed-lockfile.ts \
    && HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 bun install --lockfile-only \
    && bun install --production --frozen-lockfile --os=linux --cpu="$(case "$TARGETARCH" in amd64) echo x64 ;; arm64) echo arm64 ;; *) echo "unsupported TARGETARCH '$TARGETARCH'" >&2; exit 1 ;; esac)" --ignore-scripts

FROM oven/bun:1.4.5-slim AS runtime

# Chromium-Dependencies für Headless-Betrieb. System-chromium (debian-package)
# statt Puppeteer's prebuilt Chrome for Testing — letzteres ist x86_64-only
# (LINUX_ARM-platform mapped trotzdem auf "linux64"-binary). Auf ARM64-Runnern
# (cdgs-runner, OrbStack auf Apple Silicon) wäre Puppeteer's prebuilt nicht
# ausführbar.
# The weekly no-cache rebuild also pulls in Debian security updates for the base packages.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    fonts-crosextra-caladea \
    fonts-crosextra-carlito \
    fonts-liberation \
    poppler-utils \
    tini \
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
COPY --chown=puppeteer:puppeteer --from=deps /app/package.json ./
COPY --chown=puppeteer:puppeteer --from=deps /app/node_modules ./node_modules
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY --chown=puppeteer:puppeteer apps/puppeteer-service ./apps/puppeteer-service

USER 10001

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:3000/healthz || exit 1

# bun as PID 1 does not reap orphans: every idle close of Chromium would leave
# zombie chromium/crashpad processes behind. tini reaps them and forwards SIGTERM.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "apps/puppeteer-service/src/index.ts"]

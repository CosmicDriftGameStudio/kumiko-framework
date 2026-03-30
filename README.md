# Kumiko

Config-driven, command-based, realtime Multi-Tenant App Framework.

## Quickstart

### Voraussetzungen

- [Bun](https://bun.sh/) (Server Runtime)
- [Node.js](https://nodejs.org/) >= 20 (Yarn / Expo)
- [Docker](https://www.docker.com/) (PostgreSQL + Redis)

### Setup

```bash
git clone git@github.com:bender0oo0/kumiko.git
cd kumiko
yarn install
```

### Services starten

```bash
docker compose up -d
```

Startet PostgreSQL (Port 5432) und Redis (Port 6379).

### ENV einrichten

```bash
cp .env.example .env
```

### Checks

```bash
# Biome (Lint + Format)
yarn biome check .

# TypeScript
yarn typecheck

# Tests
yarn test:run
```

---

## Was funktioniert bisher

### Step 1: Monorepo + Package Setup

- Yarn 1 Workspaces mit `@kumiko/framework`, 2 Feature-Packages, App-Shell
- Biome Linting/Formatting (React-Regeln fuer UI, relaxed fuer Server)
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Docker Compose (PostgreSQL 17 + Redis 7)
- Vitest konfiguriert

```bash
# Verify: Biome laeuft sauber
yarn biome check .

# Verify: Workspace-Linking funktioniert
node -e "const p = require('./features/admin-users/package.json'); console.log(p.dependencies)"
# -> { '@kumiko/framework': '*' }
```

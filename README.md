# Kumiko

Config-driven, command-based, realtime Multi-Tenant App Framework.

## Quickstart

### Voraussetzungen

- [Bun](https://bun.sh/) (Server Runtime)
- [Node.js](https://nodejs.org/) >= 20 (Yarn)
- [Docker](https://www.docker.com/) (PostgreSQL + Redis)

### Setup

```bash
git clone git@github.com:bender0oo0/kumiko.git
cd kumiko
yarn install
cp .env.example .env
```

### Los geht's

```bash
# Interaktive CLI — zeigt alle Befehle
yarn kumiko

# Oder direkt:
yarn kumiko dev        # Docker Services starten (PG:15432, Redis:16379)
yarn kumiko status     # Was laeuft gerade?
yarn kumiko test       # Geaenderte Tests ausfuehren
yarn kumiko test all   # Alle Tests
yarn kumiko check      # Biome + TypeScript + Tests
yarn kumiko reset      # Alles platt machen und neu starten
yarn kumiko stop       # Services stoppen
```

---

## Was funktioniert bisher

### Step 1: Monorepo + Package Setup

- Yarn 1 Workspaces mit `@kumiko/framework`, 2 Feature-Packages, App-Shell
- Biome Linting/Formatting (React-Regeln fuer UI, relaxed fuer Server)
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Docker Compose (PostgreSQL 17 + Redis 7) auf hohen Ports (keine Konflikte)
- Vitest konfiguriert
- `yarn kumiko` CLI fuer alle Operationen

```bash
# Verify: Services starten
yarn kumiko dev

# Verify: Biome laeuft sauber
yarn kumiko check

# Verify: Workspace-Linking funktioniert
node -e "const p = require('./features/admin-users/package.json'); console.log(p.dependencies)"
# -> { '@kumiko/framework': '*' }
```

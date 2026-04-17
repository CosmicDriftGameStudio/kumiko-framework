# Kumiko

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-black.svg)](https://bun.sh)

> **"With Kumiko, everything is faster!"** <sup>\*faster than building it all from scratch again without Kumiko. Sample size: n=1 (the author).</sup>
>
> **"90% of developers say: Kumiko makes everything faster."** <sup>\*we asked 10.</sup>
>
> **"Enterprise-ready since day one."** <sup>\*day one hasn't arrived yet.</sup>
>
> **"Battle-tested in production."** <sup>\*the production of demo samples.</sup>
>
> **"Multi-tenant out of the box."** <sup>\*box not included.</sup>
>
> **"Zero-config."** <sup>\*after the initial 47-step setup.</sup>
>
> **"Realtime with <1ms latency."** <sup>\*on localhost, Wi-Fi off, exactly one tenant named "test".</sup>
>
> **"Scales to millions of users."** <sup>\*theoretically, provided Postgres, Redis, Meilisearch, and your wallet all cooperate.</sup>
>
> **"Type-safe down to the last line."** <sup>\*`any` is also a type.</sup>
>
> **"Kumiko — because framework frameworks need a framework too."**

---

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

### Step 2: Engine (Registry, defineFeature, Access)

- `defineFeature()` — Features deklarativ registrieren
- `r.entity()` — Entities mit typisierten Fields und `searchable`
- `r.writeHandler()` / `r.queryHandler()` — Handler mit Zod-Schema und voller Type-Inference
- `r.translations()` — i18n Keys pro Feature
- `createRegistry()` — Sammelt Features, validiert Duplikate, merged Translations
- `hasAccess()` — Rollen-basierte Zugriffskontrolle mit String-Unions
- Factory Functions: `createTextField()`, `createEntity()`, etc.

```bash
# Verify: 126 Tests (Step 2-12)
yarn kumiko test packages/framework/src/engine

# Verify: Feature mit Handler definieren
bun -e "
import { defineFeature, createEntity, createTextField } from './packages/framework/src/engine';

const feature = defineFeature('demo', (r) => {
  r.entity('user', createEntity({
    table: 'Users',
    fields: { email: createTextField({ searchable: true }) },
  }));
});

console.log('Feature:', feature.name);
console.log('Entities:', Object.keys(feature.entities));
"

# Verify: Entity → Zod Schema
bun -e "
import { createEntity, createTextField, createBooleanField, buildInsertSchema } from './packages/framework/src/engine';

const entity = createEntity({
  table: 'Users',
  fields: {
    email: createTextField({ required: true, format: 'email' }),
    name: createTextField(),
    active: createBooleanField({ default: true }),
  },
});

const schema = buildInsertSchema(entity);
console.log('Valid:', schema.safeParse({ email: 'a@b.de' }).success);           // true
console.log('Default:', schema.parse({ email: 'a@b.de' }).active);             // true
console.log('Invalid:', schema.safeParse({ email: 'not-email' }).success);      // false
"
```

### Step 3: Schema Builder (Entity → Zod)

- `buildInsertSchema()` — Entity-Definition → Zod Schema fuer Inserts (required + defaults)
- `buildUpdateSchema()` — Alles partial fuer Updates
- Automatisch: maxLength, email-Format, select-Optionen, Defaults
- Kein manuelles Schema-Schreiben pro Entity

### Step 4: CRUD Builder (Entity → Commands)

- `r.crud("user")` → registriert automatisch 5 Handler:
  - `user.create` (Insert-Schema), `user.update` (Partial + ID), `user.delete` (ID)
  - `user.list` (Cursor + Search), `user.detail` (ID)
- Access-Rules werden an alle Handler durchgereicht
- Handler sind Stubs — echte DB-Logik kommt in Step 8

```bash
# Verify: CRUD Builder
bun -e "
import { defineFeature, createEntity, createTextField } from './packages/framework/src/engine';

const feature = defineFeature('demo', (r) => {
  r.entity('post', createEntity({ table: 'Posts', fields: { title: createTextField({ required: true }) } }));
  r.crud('post', { access: { roles: ['Admin'] } });
});

console.log('Write handlers:', Object.keys(feature.writeHandlers));
console.log('Query handlers:', Object.keys(feature.queryHandlers));
"
```

### Step 5: i18n Engine

- `createI18n(registry, { defaultLocale: "de" })` — Translations aus allen Features
- Fallback auf Default-Locale wenn Sprache fehlt
- Key zurueck wenn Translation nicht existiert

### Step 6: Validation Hooks

- `r.hook("validation", "formName", fn)` — Custom Validation pro Feature
- `runValidation(registry, "formName", data)` — Sammelt Errors aus allen Features
- Cross-Field Validation, Business Rules — was Zod allein nicht kann

### Step 7: Drizzle Helpers (DB Layer)

- `buildDrizzleTable()` — Entity-Definition → Drizzle Table mit Base Columns
- `applyCursorQuery()` — Cursor Pagination + Tenant-Isolation + Search + Soft-Delete
- `encodeCursor()` / `decodeCursor()` — URL-safe Base64 Cursor
- `createDbConnection()` — PostgreSQL Verbindung via postgres.js
- Base Columns: id, tenantId, insertedAt, modifiedAt, insertedById, modifiedById
- **Erster Integration Test** — echte PostgreSQL Queries

```bash
# Verify: Unit Tests (kein Docker noetig)
yarn kumiko test packages/framework/src/db/__tests__/db-helpers.test.ts

# Verify: Integration Tests (Docker muss laufen)
yarn kumiko test integration
```

### Step 8: CRUD Executor (echte DB)

- `createCrudExecutor(table, entity, searchableFields)` — generischer CRUD fuer jede Entity
- create: Insert mit Tenant + Audit Fields
- update: Partial Update, Tenant-isoliert
- delete: Soft-Delete oder Hard-Delete je nach Entity Config
- list: Cursor Pagination + Search
- detail: Single Row, Tenant-isoliert
- `createTestDb()` — automatische Test-DB Erstellung/Cleanup (uuid-basiert)

### Step 9: Message Dispatcher (In-Memory)

- `createDispatcher(registry, context)` — zentraler Message-Eingang
- `dispatcher.write("type", payload, user)` — State aendern, Result zurueck
- `dispatcher.query("type", payload, user)` — Daten lesen
- `dispatcher.command("type", payload, user)` — Fire-and-forget
- Automatisch: Zod-Validation, Access-Check, Validation Hooks
- Kein Handler kann diese Checks umgehen

### Step 10: Async Pipeline (Event Dispatcher + Idempotency)

> Historischer Stand: Redis Pub/Sub + Streams. Seit Sprint D.2–D.5 laeuft die
> gesamte asynchrone Zustellung (SSE, Search, `ctx.emit`, `r.postEvent`) ueber
> die `events`-Tabelle + den cursor-basierten Event-Dispatcher
> (AsyncDaemon-Pattern). Aktueller Stand: siehe [CHANGELOG.md](./CHANGELOG.md)
> und [packages/framework/README.md](./packages/framework/README.md).

- Cursor-basierter Event-Dispatcher, per-Consumer Checkpoint in `kumiko_event_consumers`
- Halt-on-poison + Dead-Letter nach N Retries pro Consumer
- `createIdempotencyGuard(redis)` — Dedupliziert Writes per Request-ID (TTL-basiert)
- `createTestRedis()` — Isolierte Redis-DB pro Test-Suite (BullMQ + SSE-Broker)

### Step 11: Hono Server + Auth + Routes

- `buildServer({ registry, context, jwtSecret })` — Komplette Hono App
- JWT Auth via jose (sign/verify, Bearer Token)
- `POST /api/write` — State aendern (200/400)
- `POST /api/query` — Daten lesen (200/404)
- `POST /api/command` — Fire-and-forget (202/403)
- `GET /health` — Health Check (kein Auth)
- Alles in-memory testbar via Hono Test Client

### Step 12: SSE Broker + Distributed Locks

- `createSseBroker()` — In-Memory SSE Connection Manager (Channels, Push, Heartbeat)
- `createSseRoute(broker)` — `GET /api/sse?channel=...` mit Auto-Reconnect Heartbeat
- `createDistributedLock(redis)` — Atomic Lock/Release mit TTL (Lua-basiert, owner-safe)

---

## Contributing

Beiträge willkommen — siehe [CONTRIBUTING.md](./CONTRIBUTING.md) für Setup, Conventions und was gemerged wird (und was nicht).

Kurzfassung:
- Roadmap in `docs/plans/uebersicht.md` — neue Features bitte vorher diskutieren
- Jedes Feature braucht ein Sample in `samples/`
- Integration-Tests ohne Mocks, Full-Stack oder nicht relevant

## License

[MIT](./LICENSE) © 2026 Marc Frost

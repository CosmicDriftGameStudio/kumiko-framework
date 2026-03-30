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

### Step 2: Engine (Registry, defineFeature, Access)

- `defineFeature()` — Features deklarativ registrieren
- `r.entity()` — Entities mit typisierten Fields und `searchable`
- `r.writeHandler()` / `r.queryHandler()` — Handler mit Zod-Schema und voller Type-Inference
- `r.translations()` — i18n Keys pro Feature
- `createRegistry()` — Sammelt Features, validiert Duplikate, merged Translations
- `hasAccess()` — Rollen-basierte Zugriffskontrolle mit String-Unions
- Factory Functions: `createTextField()`, `createEntity()`, etc.

```bash
# Verify: 59 Tests (Step 2-6)
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

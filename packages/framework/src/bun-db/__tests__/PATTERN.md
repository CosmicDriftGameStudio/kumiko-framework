# Pattern: Provider-agnostische DB-Integration-Tests

## Architektur

```
db/api.ts                    createConnection() — liest DB_PROVIDER env
db/postgres-provider.ts      postgres-js Factory (default, stabil)
db/bun-provider.ts           Bun.SQL Factory (DB_PROVIDER=bun, experimentell)
stack/db.ts                  createTestDb() — provider-agnostisch via createConnection
stack/test-stack.ts          setupTestStack() — provider-agnostisch via createTestDb
bun-db/__tests__/bun-test-stack.ts  Alias: setupBunTestStack → setupTestStack
bun-db/__tests__/bun-test-db.ts     Alias: createBunTestDb → createTestDb
```

## Snippet: Integration-Test

```typescript
import { setupTestStack, type TestStack } from "../stack";
import { defineFeature } from "../engine";

const feature = defineFeature("example", (r) => { /* ... */ });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

test("works", async () => {
  // stack.db    → provider-agnostic (asRawClient für .unsafe/.begin)
  // stack.http  → RequestHelper (writeOk, queryOk, raw)
  // stack.redis → TestRedis
  // stack.events → EventCollector
});
```

Nur DB (ohne HTTP/Stack):

```typescript
import { createTestDb, type TestDb } from "../stack";
import { asRawClient } from "../bun-db/query";

let td: TestDb;
beforeAll(async () => { td = await createTestDb(); });
afterAll(async () => { await td.cleanup(); });
test("works", async () => {
  await asRawClient(td.db).unsafe("SELECT 1");
});
```

## Switching Driver

```bash
# Default: postgres-js
bun test ./src/**/*.integration.ts

# Bun.SQL (experimentell)
DB_PROVIDER=bun bun test ./src/**/*.integration.ts
```

## Bekannte Issues

- **Bun.SQL Extended-Query-Protocol Bug**: PostgresError "bind message has 11 result
  formats but query has 1 columns" bei sequentiellen Queries mit unterschiedlicher
  Spaltenzahl innerhalb derselben Transaction. Nur bei `DB_PROVIDER=bun`.
- **Temporal-Polyfill**: `createTestDb()` ruft jetzt `ensureTemporalPolyfill()` auf.
- **TenantDb.insertOne**: Immer `tdb.insertOne(table, ...)` verwenden (Methode),
  NICHT `insertOne(tdb, table, ...)` (standalone aus bun-db/query — bypassed
  tenant-injection via asRawClient).

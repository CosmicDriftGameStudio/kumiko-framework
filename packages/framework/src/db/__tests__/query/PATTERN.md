# Pattern: DB-Integration-Tests

## Architektur

```
db/connection.ts                      createDbConnection({ url, ... }) — Bun.SQL
db/query.ts                           Query-Helper (selectMany, insertOne, asRawClient, ...)
testing/src/stack/db.ts               createTestDb() — Test-DB via createDbConnection
testing/src/stack/test-stack.ts       setupTestStack() — baut auf createTestDb
db/__tests__/query/bun-test-db.ts     Alias: createBunTestDb → createTestDb
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
  // stack.db    → Bun.SQL (asRawClient für .unsafe/.begin)
  // stack.http  → RequestHelper (writeOk, queryOk, raw)
  // stack.redis → TestRedis
  // stack.events → EventCollector
});
```

Nur DB (ohne HTTP/Stack):

```typescript
import { createTestDb, type TestDb } from "../stack";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";

let td: TestDb;
beforeAll(async () => { td = await createTestDb(); });
afterAll(async () => { await td.cleanup(); });
test("works", async () => {
  await asRawClient(td.db).unsafe("SELECT 1");
});
```

## Bekannte Issues

- **Temporal-Polyfill**: `createTestDb()` ruft jetzt `ensureTemporalPolyfill()` auf.
- **TenantDb.insertOne**: Immer `tdb.insertOne(table, ...)` verwenden (Methode),
  NICHT `insertOne(tdb, table, ...)` (standalone aus db/query — bypassed
  tenant-injection via asRawClient).

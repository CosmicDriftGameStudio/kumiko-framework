# Pattern: Integration-Tests auf Bun.SQL umstellen

## Neue Helper (bun-db/__tests__/)

### `createBunTestDb()` (bun-test-db.ts)
Bun.SQL-only Ersatz für `createTestDb()`:
- Admin-`Bun.SQL` → `CREATE DATABASE "kumiko_test_<random>"`
- Test-`Bun.SQL` zur neuen DB
- `cleanup()` droppt die DB
- KEIN postgres-js, KEIN Drizzle

### `setupBunTestStack()` (bun-test-stack.ts)
Bun.SQL-only Ersatz für `setupTestStack()`:
- Nutzt `createBunTestDb()` statt `createTestDb()`
- Gleiches Hono/Redis/SSE/Search-Wiring wie `setupTestStack`
- Kein `pgClient` für LISTEN — Tests nutzen `runOnce()` deterministisch
- IdempotencyGuard, EventDedup, EntityCache (Redis) inklusive

---

## Was sich pro File geändert hat

### 1. `snapshot.integration.ts` — createTestDb → createBunTestDb
**Vorher:** `createTestDb()` (postgres-js) + eigene Tables via `createEventsTable()`  
**Nachher:** `createBunTestDb()` + `ensureTemporalPolyfill()` (fehlte vorher → Tests waren rot)  
**Änderung:** 2 Zeilen Imports, Setup/Teardown auf BunTestDb umgestellt  
**Besonderheit:** `bun.db` direkt an event-store-APIs übergeben — Bun.SQL und postgres-js sind strukturell kompatibel (`.unsafe()`, `.begin()`)

### 2. `load-aggregate-query.integration.ts` — setupTestStack → setupBunTestStack
**Vorher:** `setupTestStack({ features, systemHooks: [] })`  
**Nachher:** `setupBunTestStack({ features, systemHooks: [] })`  
**Änderung:** 3 Zeilen (import + setup/teardown)  
**Besonderheit:** `resetEventStore(stack, ...)` erwartet `TestStack`-Type, aber nutzt nur `.db` und `.eventDispatcher` — beides in `BunTestStack` vorhanden

### 3. `anonymous-access.integration.ts` — setupTestStack → setupBunTestStack
**Vorher:** 3× `setupTestStack({ features, anonymousAccess: ... })`  
**Nachher:** 3× `setupBunTestStack({ features, anonymousAccess: ... })`  
**Änderung:** 3× Import + Typ, 3× setup-Aufruf  
**Besonderheit:** `anonymousAccess`-Factory-Form (Funktion) wird von setupBunTestStack NICHT unterstützt — wird aber in diesem File nicht genutzt

### 4. `full-stack.integration.ts` — setupTestStack → setupBunTestStack
**Vorher:** `setupTestStack({ features: [userFeature] })`  
**Nachher:** `setupBunTestStack({ features: [userFeature] })`  
**Änderung:** 3 Zeilen imports, setup/teardown  
**Besonderheit:** IdempotencyGuard + EntityCache mussten in setupBunTestStack nachgerüstet werden (Redis), sonst 2 neue Fails

---

## Stolpersteine

### Connection-Lifecycle / asyncDispose
`new Bun.SQL(url)` erzeugt einen internen Pool. Connection teilen (Singleton) ist safe — Bun.SQL managed Pool-Lifecycle. Kein asyncDispose-Problem in diesen 4 Files.

### Transaction-Behavior
`Bun.SQL.begin(async tx => {...})` verhält sich wie postgres-js `db.begin()` — `tx` hat `.unsafe()` für Raw-SQL. `asRawClient(tx)` erkennt Bun.SQL-transactions (via `.unsafe`-Check direkt auf dem Objekt).

### Temporal-Polyfill
`createTestDb()` ruft NICHT `ensureTemporalPolyfill()` auf — Tests die direkt `createTestDb` nutzen fliegen mit `Temporal is not defined`. `setupTestStack()` und `setupBunTestStack()` inkludieren den Aufruf.

### LISTEN/NOTIFY
Bun.SQL 1.2.x hat kein `listen()`. Der event-dispatcher braucht postgres-js für LISTEN-Wakeup. Ohne `pgClient` fällt er auf polling-only zurück (pollIntervalMs=50). Tests die `runOnce()` nutzen sind davon nicht betroffen.

### IdempotencyGuard + EntityCache
Redis-backed Middleware (IdempotencyGuard, EventDedup, EntityCache) muss explizit gesetzt werden — fehlt sie, funktionieren idempotency- und cache-Tests nicht.

---

## Snippet: So sieht ein neuer Integration-Test aus

```typescript
// Bun.SQL-only setup. KEIN postgres-js, KEIN createTestDb/setupTestStack.
import { setupBunTestStack, type BunTestStack } from "../bun-db/__tests__/bun-test-stack";
import { defineFeature } from "../engine";

const feature = defineFeature("example", (r) => { /* ... */ });

let stack: BunTestStack;

beforeAll(async () => {
  stack = await setupBunTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

test("works", async () => {
  // stack.db    → Bun.SQL (begin, unsafe, query-API)
  // stack.http  → RequestHelper (writeOk, queryOk, raw)
  // stack.redis → TestRedis
  // stack.events → EventCollector
  // stack.search → SearchAdapter
});
```

Wenn nur DB (kein HTTP/Stack) gebraucht wird:

```typescript
import { createBunTestDb, type BunTestDb } from "../bun-db/__tests__/bun-test-db";
import { ensureTemporalPolyfill } from "../time/polyfill";

let bun: BunTestDb;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  bun = await createBunTestDb();
});

afterAll(async () => {
  await bun.cleanup();
});

test("works", async () => {
  await bun.db.unsafe("SELECT 1");
  // asRawClient(bun.db) für Raw-SQL-API
});
```

// Live==Rebuild-Equivalence für die ImplicitProjection (Sprint G).
//
// Beweist: für jede r.entity erzeugt der EventStoreExecutor (live) und
// rebuildProjection (replay über Implicit-Projection) **denselben**
// Tabellen-Stand. Ohne diesen Test können live + rebuild zwischen den
// Releases auseinanderdriften (z.B. wenn jemand die Live-Schreib-Logik
// im Executor ändert ohne applyEntityEvent anzupassen).
//
// Test-Strategie:
//   1. Live: 4 Aggregate mit verschiedenen Lifecycles (create / update /
//      soft-delete / restore) durch den EventStoreExecutor jagen
//   2. Snapshot der Entity-Tabelle (nach Sortierung — ORDER BY id)
//   3. TRUNCATE der Entity-Tabelle
//   4. rebuildProjection für die ImplicitProjection
//   5. Snapshot erneut nehmen
//   6. deep-equal: identische Rows in identischer Reihenfolge

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createBooleanField, createEntity, createTextField, defineFeature } from "../../engine";
import { createRegistry } from "../../engine/registry";
import { createEventsTable } from "../../event-store";
import { rebuildProjection } from "../../pipeline";
import { createProjectionStateTable } from "../../pipeline/projection-state";
import { createTestDb, type TestDb, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildDrizzleTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const userEntity = createEntity({
  table: "read_implicit_users",
  fields: {
    email: createTextField({ required: true }),
    firstName: createTextField(),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const userFeature = defineFeature("implicittest", (r) => {
  r.entity("user", userEntity);
});

const userTable = buildDrizzleTable("user", userEntity);

let testDb: TestDb;
let tdb: TenantDb;
const adminUser = TestUsers.admin;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity, "user");
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  tdb = createTenantDb(testDb.db, adminUser.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_implicit_users, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

async function snapshotTable(): Promise<readonly Record<string, unknown>[]> {
  const rows = await selectMany(testDb.db, userTable, { orderBy: { col: "id", direction: "asc" } });
  return rows as readonly Record<string, unknown>[];
}

describe("implicit-projection / Live==Rebuild equivalence", () => {
  test("4 aggregates × create/update/delete/restore round-trip identical to rebuild", async () => {
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

    // 1. Live writes — verschiedene Lifecycle-Pfade über die 4 Aggregate.
    //    Aggregate A: create + update
    //    Aggregate B: create + update + delete (soft)
    //    Aggregate C: create + delete + restore
    //    Aggregate D: create only
    const a = await crud.create({ email: "a@test.de", firstName: "Alice" }, adminUser, tdb);
    if (!a.isSuccess) throw new Error("setup A failed");
    await crud.update(
      { id: a.data.id, version: 1, changes: { firstName: "Alice Updated" } },
      adminUser,
      tdb,
    );

    const b = await crud.create({ email: "b@test.de", firstName: "Bob" }, adminUser, tdb);
    if (!b.isSuccess) throw new Error("setup B failed");
    await crud.update({ id: b.data.id, version: 1, changes: { isEnabled: false } }, adminUser, tdb);
    await crud.delete({ id: b.data.id }, adminUser, tdb);

    const c = await crud.create({ email: "c@test.de", firstName: "Carol" }, adminUser, tdb);
    if (!c.isSuccess) throw new Error("setup C failed");
    await crud.delete({ id: c.data.id }, adminUser, tdb);
    await crud.restore({ id: c.data.id }, adminUser, tdb);

    await crud.create({ email: "d@test.de", firstName: "Dave" }, adminUser, tdb);

    const liveSnapshot = await snapshotTable();

    // Konkrete Erwartung an den Live-Stand: 4 erzeugte Aggregate, B ist
    // soft-deleted (isDeleted=true), C ist restored (isDeleted=false),
    // A und D sind unangetastet. Wenn das nicht stimmt, ist der Test
    // setup buggy bevor wir den Rebuild überhaupt vergleichen.
    expect(liveSnapshot).toHaveLength(4);
    const byEmail = new Map(liveSnapshot.map((r) => [r["email"] as string, r]));
    expect(byEmail.get("a@test.de")).toMatchObject({
      firstName: "Alice Updated",
      version: 2,
      isDeleted: false,
    });
    expect(byEmail.get("b@test.de")).toMatchObject({
      isEnabled: false,
      version: 3,
      isDeleted: true,
    });
    expect(byEmail.get("c@test.de")).toMatchObject({
      version: 3,
      isDeleted: false,
    });
    expect(byEmail.get("d@test.de")).toMatchObject({
      firstName: "Dave",
      version: 1,
      isDeleted: false,
    });

    // 2. Rebuild from event-log — registry baut die ImplicitProjection,
    //    rebuildProjection findet sie über getAllProjections().
    const registry = createRegistry([userFeature]);
    const implicitName = "implicittest:projection:user-entity";
    expect(registry.getAllProjections().has(implicitName)).toBe(true);

    const result = await rebuildProjection(implicitName, {
      db: testDb.db,
      registry,
    });

    // 4 creates + 2 updates + 2 deletes + 1 restore = 9 Events. Wenn
    // die ImplicitProjection silently nichts apply'd hätte, wäre der
    // Count 0 — der Test würde dann den nachfolgenden deep-equal trotzdem
    // verfehlen, aber explizit der Count fängt den Sub-Bug "apply lief,
    // aber für die falsche Event-Anzahl".
    expect(result.eventsProcessed).toBe(9);

    // 3. Vergleich. Erst ID-für-ID strikt prüfen damit klar ist welche
    // Felder verglichen werden — dann das Array-deep-equal als Catch-all.
    const rebuildSnapshot = await snapshotTable();
    expect(rebuildSnapshot).toHaveLength(liveSnapshot.length);
    for (let i = 0; i < liveSnapshot.length; i++) {
      const live = liveSnapshot[i];
      const rebuilt = rebuildSnapshot[i];
      // Diese Felder sind die User-sichtbare Truth (was sieht die UI?
      // was schreibt der Audit-Log?). Wenn eines davon driftet, ist
      // Live==Rebuild nicht mehr gegeben.
      const fields = [
        "id",
        "tenantId",
        "version",
        "email",
        "firstName",
        "isEnabled",
        "isDeleted",
        "insertedAt",
        "modifiedAt",
        "deletedAt",
        "insertedById",
        "modifiedById",
        "deletedById",
      ] as const;
      for (const f of fields) {
        expect(rebuilt?.[f], `field "${f}" at row ${i}`).toEqual(live?.[f]);
      }
    }
    // Catch-all: irgendein Feld das wir nicht explizit listen?
    expect(rebuildSnapshot).toEqual(liveSnapshot);
  });

  test("ImplicitProjection ist im Registry registriert mit korrekten apply-keys", () => {
    const registry = createRegistry([userFeature]);
    const projection = registry.getAllProjections().get("implicittest:projection:user-entity");
    expect(projection).toBeDefined();
    if (!projection) return;
    // 4 Auto-Verben weil softDelete=true → restored kommt dazu
    expect(Object.keys(projection.apply).sort()).toEqual([
      "user.created",
      "user.deleted",
      "user.restored",
      "user.updated",
    ]);
    expect(projection.source).toBe("user");
  });

  test("ohne softDelete → keine restore-apply-key registriert", () => {
    const hardDeleteEntity = createEntity({
      table: "read_implicit_hard",
      fields: { name: createTextField({ required: true }) },
    });
    const hardFeature = defineFeature("implicithard", (r) => {
      r.entity("widget", hardDeleteEntity);
    });
    const registry = createRegistry([hardFeature]);
    const projection = registry.getAllProjections().get("implicithard:projection:widget-entity");
    expect(projection).toBeDefined();
    if (!projection) return;
    expect(Object.keys(projection.apply).sort()).toEqual([
      "widget.created",
      "widget.deleted",
      "widget.updated",
    ]);
  });
});

// Sensitive-Drift ist eine bekannte Welle-3-Lücke: das Event-Log strippt
// sensitive-Felder VOR dem Append (GDPR-Annahme), die Live-Read-Tabelle
// bekommt sie über den unstripped flatData, der Rebuild-Pfad nur den
// stripped event.payload. Bei Schema-Rebuilds gehen sensitive Daten
// verloren.
//
// Dieser Test pinst die Drift explizit: Live row hat das sensitive Feld,
// Rebuild row hat NULL. Wenn Welle 3 das fixt (z.B. via separater
// sensitive-Spalte oder verschlüsseltem Event-Payload), bricht der Test
// und zwingt zu Aufmerksamkeit.

import { asRawClient, selectMany } from "../../bun-db/query";

const sensitiveTable = "read_implicit_sensitive_users";

const sensitiveEntity = createEntity({
  table: sensitiveTable,
  fields: {
    email: createTextField({ required: true }),
    apiKey: createTextField({ sensitive: true }),
  },
});

const sensitiveFeature = defineFeature("implicitsensitive", (r) => {
  r.entity("sensitive-user", sensitiveEntity);
});

const sensitiveDrizzleTable = buildDrizzleTable("sensitive-user", sensitiveEntity);

describe("implicit-projection / dokumentierte Sensitive-Drift", () => {
  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, sensitiveEntity, "sensitive-user");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE ${sensitiveTable}, kumiko_events, kumiko_projections RESTART IDENTITY CASCADE`,
    );
  });

  test("Live schreibt sensitive-Felder, Rebuild lässt sie NULL (Welle-3-Roadmap)", async () => {
    const crud = createEventStoreExecutor(sensitiveDrizzleTable, sensitiveEntity, {
      entityName: "sensitive-user",
    });

    // 1. Live: create mit apiKey (sensitive). Read-Tabelle bekommt den
    //    Wert direkt vom Live-Pfad (unstripped flatData).
    const created = await crud.create(
      { email: "x@test.de", apiKey: "secret-token-abc" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("setup failed");

    const [liveRow] = await selectMany(testDb.db, sensitiveDrizzleTable, {
      id: created.data.id as string,
    });
    expect(liveRow?.["apiKey"]).toBe("secret-token-abc");
    expect(liveRow?.["email"]).toBe("x@test.de");

    // 2. Verifiziere dass das Event-Log das Feld NICHT enthält (stripped).
    const events = await asRawClient(testDb.db).unsafe<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM kumiko_events WHERE aggregate_id = $1::uuid`,
      [created.data.id],
    );
    expect(events[0]?.payload).toBeDefined();
    expect(events[0]?.payload?.["apiKey"]).toBeUndefined();
    expect(events[0]?.payload?.["email"]).toBe("x@test.de");

    // 3. Rebuild über die ImplicitProjection. Read-Tabelle wird aus
    //    event.payload neu materialisiert — apiKey ist nicht im Log,
    //    landet also als NULL/undefined in der rebuilt Row.
    const registry = createRegistry([sensitiveFeature]);
    await rebuildProjection("implicitsensitive:projection:sensitive-user-entity", {
      db: testDb.db,
      registry,
    });

    const [rebuiltRow] = await selectMany(testDb.db, sensitiveDrizzleTable, {
      id: created.data.id as string,
    });
    expect(rebuiltRow?.["email"]).toBe("x@test.de");
    // DAS ist die Drift: sensitive Feld ist nach Rebuild weg.
    expect(rebuiltRow?.["apiKey"]).toBeNull();
  });
});

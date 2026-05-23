// F8 — pg-unique-violation auf entity-level-Indices wird sauber zu
// einer 409 UniqueViolationError gemapped, NICHT zu einer 500
// InternalError.
//
// Der event-store-Layer hatte das schon (Sprint 4d Patch:
// EventStoreVersionConflict-catch im executor.create/update). Aber
// app-level unique-Indices auf der Projection-Tabelle (z.B. (tenantId,
// email) auf User-Entity) liefen ohne mapping durch — krachten als
// pg-23505 InternalError. F8 schließt diese Lücke.
//
// **Test-Setup:** ein User-style entity mit composite-unique-Index
// (tenantId, email). Aggregate-id ist auto-generated UUID, kollidiert
// also nicht. Erst die projection-INSERT verletzt den Index. Ohne F8:
// 500. Mit F8: writeFailure(UniqueViolationError) → 409.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { asRawClient, selectMany } from "../../bun-db/query";
import { createEntity, createTextField } from "../../engine";
import { createEventsTable } from "../../event-store";
import { createTestDb, type TestDb, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const userEntity = createEntity({
  table: "read_unique_users",
  fields: {
    email: createTextField({ required: true }),
    displayName: createTextField({ required: true }),
  },
  // softDelete=true damit wir den restore-Pfad pinnen können (siehe
  // restore-Test unten — "kein 23505 möglich" claim).
  softDelete: true,
  // Composite-unique auf (tenantId, email) — typisches User-Pattern.
  // Der unique-Index lebt auf der Projection, NICHT auf der events-
  // Tabelle. Daher fängt der existing event-store-23505-catch (Sprint
  // 4d) das nicht; das ist der Pfad den F8 abdeckt.
  indexes: [
    { columns: ["tenantId", "email"], unique: true, name: "read_unique_users_tenant_email_uniq" },
  ],
});
const table = buildEntityTable("unique-user", userEntity);
const exec = createEventStoreExecutor(table, userEntity, { entityName: "unique-user" });

let testDb: TestDb;
let tdb: TenantDb;
const admin = TestUsers.admin;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity, "unique-user");
  await createEventsTable(testDb.db);
  tdb = createTenantDb(testDb.db, admin.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_unique_users RESTART IDENTITY CASCADE`,
  );
});

// =============================================================================
// create — duplicate email → 409 unique_violation
// =============================================================================

describe("F8 — entity-level unique-violation auf create", () => {
  test("zweiter create mit selber email → unique_violation 409 (nicht internal_error 500)", async () => {
    const first = await exec.create(
      { email: "alice@example.com", displayName: "Alice 1" },
      admin,
      tdb,
    );
    expect(first.isSuccess).toBe(true);

    const second = await exec.create(
      { email: "alice@example.com", displayName: "Alice 2" },
      admin,
      tdb,
    );
    expect(second.isSuccess).toBe(false);
    if (second.isSuccess) return;
    expect(second.error.code).toBe("unique_violation");
    expect(second.error.httpStatus).toBe(409);
    // constraintName aus dem PG-error durchgereicht — App-Code kann
    // damit auf den richtigen field-name mappen.
    const details = second.error.details as { constraintName?: string; entityName?: string };
    expect(details.entityName).toBe("unique-user");
    expect(details.constraintName).toBe("read_unique_users_tenant_email_uniq");
  });

  test("DB-Beweis: nach 23505-conflict ist nur die erste Row in der Projection", async () => {
    await exec.create({ email: "bob@example.com", displayName: "Bob 1" }, admin, tdb);
    const second = await exec.create(
      { email: "bob@example.com", displayName: "Bob 2" },
      admin,
      tdb,
    );
    expect(second.isSuccess).toBe(false);
    const rows = await selectMany(testDb.db, table);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { displayName: string }).displayName).toBe("Bob 1");
  });
});

// =============================================================================
// update — change email to existing value → 409 unique_violation
// =============================================================================

describe("F8 — entity-level unique-violation auf update", () => {
  test("update auf existing email-value → unique_violation 409", async () => {
    const alice = await exec.create(
      { email: "alice@example.com", displayName: "Alice" },
      admin,
      tdb,
    );
    const bob = await exec.create({ email: "bob@example.com", displayName: "Bob" }, admin, tdb);
    if (!alice.isSuccess || !bob.isSuccess) throw new Error("create failed in setup");

    // Bob versucht Alice's email zu nehmen → kollidiert mit dem
    // existing alice-row. Vor F8 wäre das ein internal_error 500
    // gewesen.
    const conflict = await exec.update(
      { id: bob.data.id, version: 1, changes: { email: "alice@example.com" } },
      admin,
      tdb,
    );
    expect(conflict.isSuccess).toBe(false);
    if (conflict.isSuccess) return;
    expect(conflict.error.code).toBe("unique_violation");
    expect(conflict.error.httpStatus).toBe(409);
  });
});

// =============================================================================
// restore — kein try-catch nötig (drift-pin: dokumentiert die Annahme)
// =============================================================================

describe("F8 — restore touch'd nur isDeleted, kein 23505-Pfad", () => {
  test("restore einer soft-gedeleteten row mit unique-field läuft konfliktfrei durch", async () => {
    // Audit-Annahme (advisor-Punkt verifiziert): restore mutiert nur
    // isDeleted=false, kein unique-field-Touch. Der unique-Index ist
    // global (kein partial-WHERE-NOT-isDeleted in framework's table-
    // builder), also würde EIN paralleler create mit derselben email
    // schon am unique-Index scheitern (F8-create-Pfad), bevor er den
    // soft-deleted restore-Pfad konfliktfrei machen könnte.
    //
    // Dieser Test pinnt: restore allein wirft kein 23505. Wenn jemand
    // morgen einen Pfad einbaut der restore mit field-changes
    // kombiniert, fällt's hier auf — der Test war "soll konfliktfrei
    // sein", die Annahme wird laut.
    const alice = await exec.create(
      { email: "carol@example.com", displayName: "Carol" },
      admin,
      tdb,
    );
    if (!alice.isSuccess) throw new Error("create failed in setup");

    const deleted = await exec.delete({ id: alice.data.id }, admin, tdb);
    expect(deleted.isSuccess).toBe(true);

    const restored = await exec.restore({ id: alice.data.id }, admin, tdb);
    expect(restored.isSuccess).toBe(true);
  });
});

// Entity-level pg-unique-violations are mapped to a 409 UniqueViolationError,
// not a 500 InternalError.
//
// The event-store layer already handled this in executor.create/update. However,
// app-level unique indexes on the projection table, such as (tenantId, email) on
// a User entity, previously bypassed that mapping and surfaced as pg-23505
// InternalError. This closes that gap.
//
// **Test setup:** a User-style entity with a composite unique index on
// (tenantId, email). The aggregate ID is an auto-generated UUID and therefore
// cannot collide. The projection INSERT is the first operation to violate the
// index: 500 without this mapping, and writeFailure(UniqueViolationError) → 409
// with it.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient, selectMany, transaction } from "../../db/query.ts";
import { createEntity, createTextField } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createTenantDb, type TenantDb } from "../tenant-db.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

const userEntity = createEntity({
  table: "read_unique_users",
  fields: {
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    displayName: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  // softDelete=true lets this test pin the restore path, which assumes that
  // "no 23505 is possible".
  softDelete: true,
  // The composite unique index on (tenantId, email) lives on the projection,
  // not on the events table. The existing event-store 23505 catch therefore does
  // not handle this path.
  indexes: [
    { columns: ["tenantId", "email"], unique: true, name: "read_unique_users_tenant_email_uniq" },
  ],
});
const table = buildEntityTable("unique-user", userEntity);
const exec = createEventStoreExecutor(table, userEntity, { entityName: "unique-user" });

let testDb: BunTestDb;
let tdb: TenantDb;
const admin = TestUsers.admin;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity, "unique-user");
  tdb = createTenantDb({ db: testDb.db, tenantId: admin.tenantId });
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
    // Passing constraintName through lets application code map the error to the
    // correct field name.
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

    // Bob attempts to use Alice's email, colliding with the existing Alice row.
    // This previously surfaced as an internal_error 500.
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
// restore — no try-catch required; this documents the assumption
// =============================================================================

// =============================================================================
// projection-INSERT savepoint — a step-2 failure inside a shared transaction
// must not poison the enclosing begin() block
// =============================================================================

describe("F8 — a projection violation must not poison the enclosing transaction", () => {
  test("a sibling write in the same tx survives a unique-violation from the projection INSERT", async () => {
    // The path #1778 already covers for the event append but which was open for
    // the projection INSERT (step 2): on a pool connection each write
    // auto-commits on its own, so a 23505 can poison nothing. Only inside a
    // shared begin() — the kind a real handler runs, whose second write follows
    // a failed nested one — does postgres.js/Bun.SQL tear the whole block down
    // once a statement failed, even after the JS layer caught the error.
    // Without the savepoint around the projection INSERT the sibling write
    // below throws raw 25P02 instead of running cleanly.
    const outcome = await transaction(testDb.db, async (tx) => {
      const txTdb = createTenantDb({ db: tx, tenantId: admin.tenantId });
      const first = await exec.create({ email: "dup@x.de", displayName: "A" }, admin, txTdb);
      const dup = await exec.create({ email: "dup@x.de", displayName: "B" }, admin, txTdb);
      const sibling = await exec.create({ email: "fresh@x.de", displayName: "C" }, admin, txTdb);
      return { first, dup, sibling };
    });

    expect(outcome.first.isSuccess).toBe(true);
    expect(outcome.dup.isSuccess).toBe(false);
    if (!outcome.dup.isSuccess) expect(outcome.dup.error.code).toBe("unique_violation");
    // The point: the tx survives the caught violation.
    expect(outcome.sibling.isSuccess).toBe(true);
  });
});

describe("F8 — restore touch'd nur isDeleted, kein 23505-Pfad", () => {
  test("restore einer soft-gedeleteten row mit unique-field läuft konfliktfrei durch", async () => {
    // Audit assumption: restore mutates only isDeleted=false and does not touch
    // unique fields. The unique index is global, with no partial-WHERE-NOT-isDeleted
    // in the framework's table builder, so a concurrent create using the same email
    // would already fail at the unique index before it could affect the soft-deleted
    // restore path.
    //
    // This test pins that restore alone does not throw 23505. If a future path
    // combines restore with field changes, this test will expose the changed
    // assumption: the operation is expected to remain conflict-free.
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

describe("F8 — restore re-colliding with a live row that re-took the unique value", () => {
  test("restore of a soft-deleted row whose email was re-used maps to unique_violation 409", async () => {
    const old = await exec.create({ email: "dave@example.com", displayName: "Old" }, admin, tdb);
    if (!old.isSuccess) throw new Error("create failed in setup");
    const deleted = await exec.delete({ id: old.data.id }, admin, tdb);
    expect(deleted.isSuccess).toBe(true);
    const reused = await exec.create({ email: "dave@example.com", displayName: "New" }, admin, tdb);
    expect(reused.isSuccess).toBe(true);

    const restored = await exec.restore({ id: old.data.id }, admin, tdb);
    expect(restored.isSuccess).toBe(false);
    if (restored.isSuccess) return;
    expect(restored.error.code).toBe("unique_violation");
    expect(restored.error.httpStatus).toBe(409);
  });
});

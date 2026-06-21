// Coverage-Lücke (9% u+i, 0 Tests): assertExistsIn ist der referenzielle
// Existenz-Check (FK-Ersatz im ES-Modell), den Write-Handler vor dem Schreiben
// nutzen. Gibt er faelschlich null (= existiert) zurueck, schreibt der Handler
// eine dangling/cross-tenant Reference. Schwerpunkt: Tenant-Isolation.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertMany } from "../../bun-db";
import { createEntity, createTextField } from "../../engine";
import { NotFoundError } from "../../errors";
import { setupTestStack, type TestStack, testTenantId, unsafeCreateEntityTable } from "../../stack";
import { assertExistsIn } from "../assert-exists-in";
import { buildEntityTable } from "../table-builder";
import { createTenantDb } from "../tenant-db";

const orderEntity = createEntity({
  table: "ax_orders",
  fields: { name: createTextField({ required: true }) },
});
const orderTable = buildEntityTable("order", orderEntity);

const tenantA = testTenantId(71);
const tenantB = testTenantId(72);
const ID_A = "11111111-1111-4111-8111-1111110000a1";
const ID_B = "22222222-2222-4222-8222-2222220000b2";
const MISSING = "99999999-9999-4999-8999-999999990000";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  await unsafeCreateEntityTable(stack.db, orderEntity);
  await insertMany(stack.db, orderTable, [
    { id: ID_A, tenantId: tenantA, name: "A-Order" },
    { id: ID_B, tenantId: tenantB, name: "B-Order" },
  ]);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("assertExistsIn — DbConnection + explizite tenantId", () => {
  test("existierende Row → null", async () => {
    const r = await assertExistsIn(stack.db, orderTable, {
      field: "id",
      value: ID_A,
      tenantId: tenantA,
    });
    expect(r).toBeNull();
  });

  test("fehlende Row → NotFoundError", async () => {
    const r = await assertExistsIn(stack.db, orderTable, {
      field: "id",
      value: MISSING,
      tenantId: tenantA,
    });
    expect(r).toBeInstanceOf(NotFoundError);
  });

  test("ISOLATION: fremder Tenant → NotFoundError (existiert, aber nicht im Scope)", async () => {
    const r = await assertExistsIn(stack.db, orderTable, {
      field: "id",
      value: ID_B, // gehört tenantB
      tenantId: tenantA,
    });
    expect(r).toBeInstanceOf(NotFoundError);
  });

  test("zusätzliches where matcht → null (existiert)", async () => {
    const r = await assertExistsIn(stack.db, orderTable, {
      field: "id",
      value: ID_A,
      tenantId: tenantA,
      where: { name: "A-Order" },
    });
    expect(r).toBeNull();
  });
});

describe("assertExistsIn — TenantDb auto-filter", () => {
  test("eigene Row → null", async () => {
    const dbA = createTenantDb(stack.db, tenantA, "tenant");
    expect(await assertExistsIn(dbA, orderTable, { field: "id", value: ID_A })).toBeNull();
  });

  test("ISOLATION: fremde Row via TenantDb → NotFoundError", async () => {
    const dbA = createTenantDb(stack.db, tenantA, "tenant");
    const r = await assertExistsIn(dbA, orderTable, { field: "id", value: ID_B });
    expect(r).toBeInstanceOf(NotFoundError);
  });

  test("fehlende Row via TenantDb → NotFoundError", async () => {
    const dbA = createTenantDb(stack.db, tenantA, "tenant");
    const r = await assertExistsIn(dbA, orderTable, { field: "id", value: MISSING });
    expect(r).toBeInstanceOf(NotFoundError);
  });
});

describe("assertExistsIn — Fehler-Benennung + where", () => {
  test("expliziter entityName override gewinnt", async () => {
    const r = await assertExistsIn(stack.db, orderTable, {
      field: "id",
      value: MISSING,
      tenantId: tenantA,
      entityName: "Bestellung",
    });
    expect(r?.message).toContain("Bestellung");
  });

  test("zusätzliches where narrowt → existierende id + falscher name = NotFound", async () => {
    const r = await assertExistsIn(stack.db, orderTable, {
      field: "id",
      value: ID_A,
      tenantId: tenantA,
      where: { name: "nope" },
    });
    expect(r).toBeInstanceOf(NotFoundError);
  });
});

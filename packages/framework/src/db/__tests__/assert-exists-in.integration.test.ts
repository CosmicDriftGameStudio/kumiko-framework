// Coverage gap (9% u+i, 0 tests): assertExistsIn is the referential
// existence check (FK replacement in the ES model) that write handlers must
// use before writing. If it incorrectly returns null (= exists), the handler
// writes a dangling/cross-tenant reference. Focus: tenant isolation.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createEntity, createTextField } from "../../engine/index.ts";
import { NotFoundError } from "../../errors/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { assertExistsIn } from "../assert-exists-in.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createTenantDb } from "../tenant-db.ts";

const orderEntity = createEntity({
  table: "ax_orders",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
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
  await seedRows(stack.db, orderTable, [
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

  test("ISOLATION: foreign tenant → NotFoundError (exists, but outside scope)", async () => {
    const r = await assertExistsIn(stack.db, orderTable, {
      field: "id",
      value: ID_B, // belongs to tenantB
      tenantId: tenantA,
    });
    expect(r).toBeInstanceOf(NotFoundError);
  });

  test("additional where matches → null (exists)", async () => {
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
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA, mode: "tenant" });
    expect(await assertExistsIn(dbA, orderTable, { field: "id", value: ID_A })).toBeNull();
  });

  test("ISOLATION: fremde Row via TenantDb → NotFoundError", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA, mode: "tenant" });
    const r = await assertExistsIn(dbA, orderTable, { field: "id", value: ID_B });
    expect(r).toBeInstanceOf(NotFoundError);
  });

  test("fehlende Row via TenantDb → NotFoundError", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA, mode: "tenant" });
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

  test("additional where narrows → existing id + wrong name = NotFound", async () => {
    const r = await assertExistsIn(stack.db, orderTable, {
      field: "id",
      value: ID_A,
      tenantId: tenantA,
      where: { name: "nope" },
    });
    expect(r).toBeInstanceOf(NotFoundError);
  });
});

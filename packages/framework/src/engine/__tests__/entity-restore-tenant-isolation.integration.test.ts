// restore() used to load its target row with selectMany(db.raw, ...) — a raw,
// unfiltered read. Any caller holding the write role could therefore un-delete
// a soft-deleted row belonging to another tenant and got the decrypted row back
// in the response. delete() never had that hole (it goes through the
// tenant-scoped loadById). These tests pin both halves: the tenant-scoped
// handler must not reach across, and the crossTenant/escapeHatch handlers
// must still be able to.
//
// Three stacks on the SAME Postgres database: one registers the restore
// handler without `crossTenant`/`escapeHatch`, one with the deprecated
// `crossTenant: true`, one with `escapeHatch: { reason }`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityRestoreHandler,
  defineFeature,
  from,
} from "../index";

const thingEntity = createEntity({
  table: "ctrestore_things",
  softDelete: true,
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  access: { write: { Admin: "all", SystemAdmin: from("user:tenantId", "tenantId") } },
});
const thingTable = buildEntityTable("thing", thingEntity);

const ESCAPE_HATCH_REASON = "fw#2915 integration test — operator restores a foreign tenant's row";

function buildFeature(crossTenant: boolean, escapeHatch?: boolean) {
  return defineFeature("ctrestore", (r) => {
    r.entity("thing", thingEntity);
    r.writeHandler(
      defineEntityCreateHandler("thing", thingEntity, {
        access: { roles: ["Admin", "SystemAdmin"] },
      }),
    );
    r.writeHandler(
      defineEntityDeleteHandler("thing", thingEntity, {
        access: { roles: ["Admin", "SystemAdmin"] },
      }),
    );
    r.writeHandler(
      defineEntityRestoreHandler("thing", thingEntity, {
        access: { roles: ["Admin", "SystemAdmin"] },
        ...(crossTenant && { crossTenant: true }),
        ...(escapeHatch && { escapeHatch: { reason: ESCAPE_HATCH_REASON } }),
      }),
    );
  });
}

const dbName = `kumiko_test_ctrestore_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

let tenantScopedStack: TestStack;
let crossTenantStack: TestStack;
let escapeHatchStack: TestStack;

beforeAll(async () => {
  tenantScopedStack = await setupTestStack({ features: [buildFeature(false)], dbName });
  await unsafeCreateEntityTable(tenantScopedStack.db, thingEntity, "thing");
  crossTenantStack = await setupTestStack({
    features: [buildFeature(true)],
    dbName,
    persistentDb: true,
  });
  escapeHatchStack = await setupTestStack({
    features: [buildFeature(false, true)],
    dbName,
    persistentDb: true,
  });
});

afterAll(async () => {
  await escapeHatchStack.cleanup();
  await crossTenantStack.cleanup();
  await tenantScopedStack.cleanup();
});

async function createDeletedThing(label: string): Promise<string> {
  const created = await tenantScopedStack.http.writeOk<{ id: string }>(
    "ctrestore:write:thing:create",
    { label },
    TestUsers.otherTenant,
  );
  await tenantScopedStack.http.writeOk(
    "ctrestore:write:thing:delete",
    { id: created.id },
    TestUsers.otherTenant,
  );

  const rows = await selectMany(tenantScopedStack.db, thingTable, { id: created.id });
  expect(rows[0]?.["isDeleted"]).toBe(true);

  return created.id;
}

describe("entity restore: tenant isolation", () => {
  test("tenant-scoped restore cannot un-delete a foreign tenant's row", async () => {
    const id = await createDeletedThing("foreign-deleted");

    const err = await tenantScopedStack.http.writeErr(
      "ctrestore:write:thing:restore",
      { id },
      TestUsers.admin,
    );
    expect(err.code).toBe("not_found");

    const rows = await selectMany(tenantScopedStack.db, thingTable, { id });
    expect(rows[0]?.["isDeleted"]).toBe(true);
  });

  test("own-tenant restore still works", async () => {
    const id = await createDeletedThing("own-restore");

    await tenantScopedStack.http.writeOk(
      "ctrestore:write:thing:restore",
      { id },
      TestUsers.otherTenant,
    );

    const rows = await selectMany(tenantScopedStack.db, thingTable, { id });
    expect(rows[0]?.["isDeleted"]).toBe(false);
  });

  test("crossTenant restore still reaches a foreign tenant's row", async () => {
    const id = await createDeletedThing("crosstenant-restore");

    await crossTenantStack.http.writeOk(
      "ctrestore:write:thing:restore",
      { id },
      TestUsers.systemAdmin,
    );

    const rows = await selectMany(tenantScopedStack.db, thingTable, { id });
    expect(rows[0]?.["isDeleted"]).toBe(false);
    expect(rows[0]?.["tenantId"]).toBe(testTenantId(2));
  });

  test("escapeHatch restore still reaches a foreign tenant's row", async () => {
    const id = await createDeletedThing("escape-hatch-restore");

    await escapeHatchStack.http.writeOk(
      "ctrestore:write:thing:restore",
      { id },
      TestUsers.systemAdmin,
    );

    const rows = await selectMany(tenantScopedStack.db, thingTable, { id });
    expect(rows[0]?.["isDeleted"]).toBe(false);
    expect(rows[0]?.["tenantId"]).toBe(testTenantId(2));
  });
});

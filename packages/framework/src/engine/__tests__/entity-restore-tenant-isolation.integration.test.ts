// restore() used to load its target row with selectMany(db.raw, ...) — a raw,
// unfiltered read. Any caller holding the write role could therefore un-delete
// a soft-deleted row belonging to another tenant and got the decrypted row back
// in the response. delete() never had that hole (it goes through the
// tenant-scoped loadById). These tests pin both halves: the tenant-scoped
// handler must not reach across, and the crossTenant handler must still be able
// to.
//
// Two stacks on the SAME Postgres database: one registers the restore handler
// without `crossTenant`, the other with it — a clean A/B on the one flag.

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
    label: createTextField({ required: true }),
  },
  access: { write: { Admin: "all", SystemAdmin: from("user:tenantId", "tenantId") } },
});
const thingTable = buildEntityTable("thing", thingEntity);

function buildFeature(crossTenant: boolean) {
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
      }),
    );
  });
}

const dbName = `kumiko_test_ctrestore_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

let tenantScopedStack: TestStack;
let crossTenantStack: TestStack;

beforeAll(async () => {
  tenantScopedStack = await setupTestStack({ features: [buildFeature(false)], dbName });
  await unsafeCreateEntityTable(tenantScopedStack.db, thingEntity, "thing");
  crossTenantStack = await setupTestStack({
    features: [buildFeature(true)],
    dbName,
    persistentDb: true,
  });
});

afterAll(async () => {
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
});

// fw#2650 — crossTenant on write handlers. A SystemAdmin operator writes a
// row that lives in a different tenant than their own session. That needs
// two things: (1) an unfiltered db instead of the caller's tenant-scoped
// one (so the row is even visible), and (2) the event-store stream AND the
// entity's tenant-based write-ownership rule — both keyed off the ACTING
// user, not the db — so the acting user's tenantId must be rewritten to the
// target row's tenant before the write, not just handed an unfiltered db.
//
// Two stacks on the SAME Postgres database: one registers the update
// handler without `crossTenant`, the other with it — a clean A/B on the one
// flag, no handler-name collisions to work around.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { eventsTable } from "../../event-store";
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
  defineEntityUpdateHandler,
  defineFeature,
  from,
} from "../index";

// "Admin" passes unconditionally (any tenant may create its own rows).
// "SystemAdmin" is tenant-scoped — this is the entity-level rule the
// crossTenant acting-user rewrite must satisfy for the operator write to
// go through; without the rewrite the acting user's own tenant would never
// match a foreign row's tenantId here.
const thingEntity = createEntity({
  table: "ctwrite_things",
  fields: {
    label: createTextField({ required: true }),
  },
  access: { write: { Admin: "all", SystemAdmin: from("user:tenantId", "tenantId") } },
});
const thingTable = buildEntityTable("thing", thingEntity);

function buildFeature(crossTenant: boolean) {
  return defineFeature("ctwrite", (r) => {
    r.entity("thing", thingEntity);
    r.writeHandler(
      defineEntityCreateHandler("thing", thingEntity, {
        access: { roles: ["Admin", "SystemAdmin"] },
      }),
    );
    r.writeHandler(
      defineEntityUpdateHandler("thing", thingEntity, {
        access: { roles: ["SystemAdmin"] },
        ...(crossTenant && { crossTenant: true }),
      }),
    );
  });
}

const dbName = `kumiko_test_ctwrite_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

let tenantScopedStack: TestStack;
let crossTenantStack: TestStack;

beforeAll(async () => {
  tenantScopedStack = await setupTestStack({ features: [buildFeature(false)], dbName });
  await unsafeCreateEntityTable(tenantScopedStack.db, thingEntity, "thing");
  // Second connection to the SAME database — persistentDb:true means its
  // cleanup() only closes the pool; tenantScopedStack (created without that
  // flag) owns the actual DROP DATABASE and must clean up last.
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

async function updatedEventTenantId(aggregateId: string): Promise<string | undefined> {
  const rows = await selectMany<{ type: string; tenantId: string }>(
    tenantScopedStack.db,
    eventsTable,
    {
      aggregateId,
    },
  );
  const updatedRow = rows.find((r) => r.type.includes("updated"));
  return updatedRow?.tenantId;
}

describe("entity write handlers: crossTenant option (fw#2650)", () => {
  test("crossTenant handler: SystemAdmin updates a row owned by another tenant", async () => {
    const created = await tenantScopedStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "foreign" },
      TestUsers.otherTenant,
    );

    const updated = await crossTenantStack.http.writeOk<{ id: string; data: { label: string } }>(
      "ctwrite:write:thing:update",
      { id: created.id, version: 1, changes: { label: "touched by operator" } },
      TestUsers.systemAdmin,
    );
    expect(updated.data.label).toBe("touched by operator");

    // Row stays on its original tenant — crossTenant reaches across the
    // tenant boundary, it does not migrate the row.
    const rows = await selectMany(tenantScopedStack.db, thingTable, { id: created.id });
    expect(rows[0]?.["tenantId"]).toBe(testTenantId(2));

    // The append must land on the row's own tenant stream, not the acting
    // (operator) user's — otherwise the append targets an empty stream in
    // the operator's tenant and the update would have failed above with a
    // bogus version_conflict rather than reaching this point at all.
    expect(await updatedEventTenantId(created.id)).toBe(testTenantId(2));
  });

  test("normal (non-crossTenant) handler cannot reach a row in another tenant", async () => {
    const created = await tenantScopedStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "foreign-untouched" },
      TestUsers.otherTenant,
    );

    const err = await tenantScopedStack.http.writeErr(
      "ctwrite:write:thing:update",
      { id: created.id, version: 1, changes: { label: "nope" } },
      TestUsers.systemAdmin,
    );
    expect(err.code).toBe("not_found");

    const rows = await selectMany(tenantScopedStack.db, thingTable, { id: created.id });
    expect(rows[0]?.["label"]).toBe("foreign-untouched");
  });

  test("crossTenant still gates on access — a role without SystemAdmin is denied", async () => {
    const created = await tenantScopedStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "foreign-denied" },
      TestUsers.otherTenant,
    );

    const err = await crossTenantStack.http.writeErr(
      "ctwrite:write:thing:update",
      { id: created.id, version: 1, changes: { label: "nope" } },
      TestUsers.admin,
    );
    expect(err.code).toBe("access_denied");
  });
});

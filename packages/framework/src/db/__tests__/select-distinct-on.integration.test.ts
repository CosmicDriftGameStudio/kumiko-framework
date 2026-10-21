// SelectOptions.distinctOn: newest-row-per-key through the tenant-scoped
// ctx.db.selectMany, against a real Postgres.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { buildEntityTable } from "../table-builder.ts";

const docEntity = createEntity({
  table: "read_distinct_on_docs",
  fields: {
    key: createTextField({ personal: false, reason: "technical_reference", required: true }),
    revision: createNumberField({ required: true }),
  },
});
const docTable = buildEntityTable("doc", docEntity);

const distinctFeature = defineFeature("distinct", (r) => {
  r.entity({ name: "doc", ...docEntity });
  const executor = createEventStoreExecutor(docTable, docEntity, { entityName: "doc" });

  r.writeHandler({
    name: "doc:create",
    schema: z.object({ key: z.string(), revision: z.number() }),
    handler: async (event, ctx) => executor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });

  r.queryHandler({
    name: "doc:latest-per-key",
    schema: z.object({}),
    handler: async (_query, ctx) =>
      ctx.db.selectMany(
        docTable,
        {},
        {
          distinctOn: ["key"],
          orderBy: [{ col: "key" }, { col: "revision", direction: "desc" }],
          fields: ["key", "revision"],
        },
      ),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
});

let stack: TestStack;
const admin = TestUsers.admin;
const otherTenantAdmin = {
  ...admin,
  tenantId: "00000000-0000-4000-8000-0000000000b0" as const,
};

beforeAll(async () => {
  stack = await setupTestStack({ features: [distinctFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, docEntity, "doc");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_distinct_on_docs"]);
});

describe("selectMany distinctOn", () => {
  test("returns the highest revision per key and only the caller's tenant", async () => {
    const create = (key: string, revision: number, user: typeof admin) =>
      stack.http.writeOk("distinct:write:doc:create", { key, revision }, user);
    await create("a", 1, admin);
    await create("a", 3, admin);
    await create("a", 2, admin);
    await create("b", 5, admin);
    await create("b", 4, admin);
    await create("a", 99, otherTenantAdmin);
    await create("c", 7, otherTenantAdmin);

    const rows = await stack.http.queryOk<Array<{ key: string; revision: number }>>(
      "distinct:query:doc:latest-per-key",
      {},
      admin,
    );
    expect(rows).toEqual([
      { key: "a", revision: 3 },
      { key: "b", revision: 5 },
    ]);

    const otherRows = await stack.http.queryOk<Array<{ key: string; revision: number }>>(
      "distinct:query:doc:latest-per-key",
      {},
      otherTenantAdmin,
    );
    expect(otherRows).toEqual([
      { key: "a", revision: 99 },
      { key: "c", revision: 7 },
    ]);
  });
});

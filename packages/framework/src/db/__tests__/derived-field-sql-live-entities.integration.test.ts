// A query handler that only names an entity in liveEntities returns signals, not rows: it must not
// let a role read SQL derived values (count/first) over that entity. An own query handler does.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import {
  createDerivedField,
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineFeature,
} from "../../engine/index.ts";
import { createTestUser, TestUsers } from "../../seeding/seed-users.ts";
import { buildEntityTable } from "../table-builder.ts";

const fixture = { personal: false, reason: "test_fixture" } as const;

const liveOnlyEntity = createEntity({
  table: "dsql_live_only",
  fields: {
    boxId: { type: "reference", entity: "dsql-box" },
    note: createTextField({ ...fixture }),
  },
  indexes: [{ columns: ["boxId"] }],
});

const ownQueryEntity = createEntity({
  table: "dsql_own_query",
  fields: { boxId: { type: "reference", entity: "dsql-box" } },
  indexes: [{ columns: ["boxId"] }],
});

const related = (entity: string) =>
  ({
    kind: "related",
    entity,
    on: { field: "boxId" },
  }) as const;

const boxEntity = createEntity({
  table: "dsql_boxes",
  fields: { name: createTextField({ required: true, ...fixture }) },
  derivedFields: {
    liveOnlyCount: createDerivedField({
      valueType: "number",
      sql: { ...related("dsql-live-only"), measure: { kind: "count" } },
    }),
    liveOnlyFirst: createDerivedField({
      valueType: "text",
      sql: {
        ...related("dsql-live-only"),
        measure: { kind: "first", field: "note", orderBy: "note", direction: "asc" },
      },
    }),
    ownQueryCount: createDerivedField({
      valueType: "number",
      sql: { ...related("dsql-own-query"), measure: { kind: "count" } },
    }),
  },
});

const feature = defineFeature("dsql", (r) => {
  const access = { roles: ["Admin", "TenantMember"] };
  r.crud("dsql-box", boxEntity, { write: { access }, read: { access } });
  r.entity({ name: "dsql-live-only", ...liveOnlyEntity });
  r.queryHandler(
    defineEntityQueryHandler("dsql-live-only:list", liveOnlyEntity, {
      access: { roles: ["Admin"] },
    }),
  );
  r.queryHandler({
    name: "live-banner",
    schema: z.object({}),
    handler: async () => ({}),
    access: { roles: ["TenantMember"] },
    liveEntities: ["dsql-live-only"],
  });
  r.entity({ name: "dsql-own-query", ...ownQueryEntity });
  r.queryHandler(
    defineEntityQueryHandler("dsql-own-query:list", ownQueryEntity, {
      access: { roles: ["TenantMember"] },
    }),
  );
});

type Page = { readonly rows: readonly Record<string, unknown>[] };
const BOX = "00000000-0000-4000-8000-000000000001";

describe("SQL derived fields and liveEntities", () => {
  let stack: TestStack;
  const admin = TestUsers.admin;
  const member = createTestUser({ id: 72, roles: ["TenantMember"] });

  beforeAll(async () => {
    stack = await setupTestStack({ features: [feature] });
    for (const [entity, name] of [
      [boxEntity, "dsql-box"],
      [liveOnlyEntity, "dsql-live-only"],
      [ownQueryEntity, "dsql-own-query"],
    ] as const) {
      await unsafeCreateEntityTable(stack.db, entity, name);
    }
    const tenantId = admin.tenantId;
    await seedRows(
      stack.db,
      buildEntityTable("dsql-box", boxEntity),
      [{ id: BOX, tenantId, name: "Box" }],
      { projectionOnly: "fixture plants a projection row without its event" },
    );
    await seedRows(
      stack.db,
      buildEntityTable("dsql-live-only", liveOnlyEntity),
      [
        { tenantId, boxId: BOX, note: "n1" },
        { tenantId, boxId: BOX, note: "n2" },
      ],
      { projectionOnly: "fixture plants a projection row without its event" },
    );
    await seedRows(
      stack.db,
      buildEntityTable("dsql-own-query", ownQueryEntity),
      [{ tenantId, boxId: BOX }],
      { projectionOnly: "fixture plants a projection row without its event" },
    );
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  async function boxRow(user: typeof admin | typeof member): Promise<Record<string, unknown>> {
    const page = await stack.http.queryOk<Page>("dsql:query:dsql-box:list", { limit: 10 }, user);
    const row = page.rows.find((r) => r["id"] === BOX);
    if (row === undefined) throw new Error("box row missing");
    return row;
  }

  test("a role whose only handler names the entity in liveEntities gets no derived values over it", async () => {
    const row = await boxRow(member);
    expect(row["liveOnlyCount"]).toBeNull();
    expect(row["liveOnlyFirst"]).toBeNull();
  });

  test("a role with an own query handler for the entity gets the derived value", async () => {
    expect((await boxRow(member))["ownQueryCount"]).toBe(1);
    const asAdmin = await boxRow(admin);
    expect(asAdmin["liveOnlyCount"]).toBe(2);
    expect(asAdmin["liveOnlyFirst"]).toBe("n1");
  });
});

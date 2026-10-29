// What a SQL derived field must not reveal: rows or labels the viewer's ownership rules hide,
// values behind a field the viewer cannot read, and entities no query handler lets the role read.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import {
  createDateField,
  createDerivedField,
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineFeature,
} from "../../engine/index.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { createTestUser, TestUsers } from "../../seeding/seed-users.ts";
import { buildEntityTable } from "../table-builder.ts";

const technical = { personal: false, reason: "technical_reference" } as const;
const fixture = { personal: false, reason: "test_fixture" } as const;

// The where-rule qualifies the column with the table name, which is what an alias must keep working.
const teamScopedRead: NonNullable<EntityDefinition["access"]> = {
  read: {
    Admin: "all",
    TenantMember: {
      kind: "where",
      where: (user, ctx) => ({
        sqlText: `${ctx.tableName}.team_id = $${ctx.paramStart}`,
        params: [user.claims?.["team"] ?? null],
      }),
    },
  },
};

const issueEntity = createEntity({
  table: "dsqa_issues",
  fields: {
    unitId: { type: "reference", entity: "dsqa-unit" },
    assigneeUnitId: { type: "reference", entity: "dsqa-unit", labelField: "name" },
    teamId: createTextField({ required: true, ...technical }),
    unitCode: createTextField({ required: true, ...technical }),
    openedOn: createDateField({ required: true }),
    internalNote: createTextField({ ...fixture, access: { read: { Admin: "all" } } }),
  },
  access: teamScopedRead,
  indexes: [{ columns: ["unitId"] }],
});

const memoEntity = createEntity({
  table: "dsqa_memos",
  fields: { unitId: { type: "reference", entity: "dsqa-unit" } },
  indexes: [{ columns: ["unitId"] }],
});

const unitEntity = createEntity({
  table: "dsqa_units",
  fields: {
    name: createTextField({ required: true, ...fixture }),
    teamId: createTextField({ required: true, ...technical }),
    secretCode: createTextField({ ...fixture, access: { read: { Admin: "all" } } }),
  },
  access: teamScopedRead,
  derivedFields: {
    // The label target is this very entity: its ownership rule must test the target row.
    assigneeLabel: createDerivedField({
      valueType: "text",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsqa-issue",
        on: { field: "unitId" },
        measure: {
          kind: "first",
          field: "assigneeUnitId",
          orderBy: "openedOn",
          direction: "desc",
          label: true,
        },
      },
    }),
    issueCount: createDerivedField({
      valueType: "number",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsqa-issue",
        on: { field: "unitId" },
        measure: { kind: "count" },
      },
    }),
    viaSecret: createDerivedField({
      valueType: "number",
      sql: {
        kind: "related",
        entity: "dsqa-issue",
        on: { field: "unitCode", outer: "secretCode" },
        measure: { kind: "count" },
      },
    }),
    noted: createDerivedField({
      valueType: "number",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsqa-issue",
        on: { field: "unitId" },
        measure: { kind: "count" },
        where: [{ field: "internalNote", op: "eq", value: "x" }],
      },
    }),
    memoCount: createDerivedField({
      valueType: "number",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsqa-memo",
        on: { field: "unitId" },
        measure: { kind: "count" },
      },
    }),
  },
});

const feature = defineFeature("dsqa", (r) => {
  const access = { roles: ["Admin", "TenantMember"] };
  r.crud("dsqa-issue", issueEntity, { write: { access }, read: { access } });
  r.crud("dsqa-unit", unitEntity, { write: { access }, read: { access } });
  // The entity itself carries no read rule, but only Admin has a query handler for it.
  r.entity({ name: "dsqa-memo", ...memoEntity });
  r.queryHandler(
    defineEntityQueryHandler("dsqa-memo:list", memoEntity, { access: { roles: ["Admin"] } }),
  );
});

const LIST = "dsqa:query:dsqa-unit:list";
const admin = TestUsers.admin;
const teamA: SessionUser = createTestUser({
  id: 71,
  roles: ["TenantMember"],
  claims: { team: "a" },
});

const uid = (n: number): string =>
  `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const A1 = uid(1);
const A2 = uid(2);
const B1 = uid(3);

type Page = { readonly rows: readonly Record<string, unknown>[] };

describe("SQL derived fields: what the viewer must not learn", () => {
  let stack: TestStack;
  const list = (payload: Record<string, unknown>, user: SessionUser): Promise<Page> =>
    stack.http.queryOk<Page>(LIST, { limit: 10, ...payload }, user);
  const ids = (page: Page): unknown[] => page.rows.map((row) => row["id"]);
  const cellOf = (page: Page, id: string, field: string): unknown =>
    page.rows.find((row) => row["id"] === id)?.[field];

  beforeAll(async () => {
    stack = await setupTestStack({ features: [feature] });
    for (const [entity, name] of [
      [unitEntity, "dsqa-unit"],
      [issueEntity, "dsqa-issue"],
      [memoEntity, "dsqa-memo"],
    ] as const) {
      await unsafeCreateEntityTable(stack.db, entity, name);
    }
    const tenantId = admin.tenantId;
    await seedRows(stack.db, buildEntityTable("dsqa-unit", unitEntity), [
      { id: A1, tenantId, name: "Alpha-1", teamId: "a", secretCode: "S1" },
      { id: A2, tenantId, name: "Alpha-2", teamId: "a", secretCode: "S2" },
      { id: B1, tenantId, name: "Secret-B", teamId: "b", secretCode: "S3" },
    ]);
    await seedRows(stack.db, buildEntityTable("dsqa-issue", issueEntity), [
      {
        tenantId,
        unitId: A1,
        assigneeUnitId: B1,
        teamId: "a",
        unitCode: "S1",
        openedOn: "2026-01-01",
        internalNote: "x",
      },
      {
        tenantId,
        unitId: A1,
        assigneeUnitId: A2,
        teamId: "a",
        unitCode: "S1",
        openedOn: "2025-01-01",
        internalNote: "y",
      },
      {
        tenantId,
        unitId: A1,
        assigneeUnitId: null,
        teamId: "b",
        unitCode: "S1",
        openedOn: "2025-06-01",
        internalNote: "x",
      },
    ]);
    await seedRows(stack.db, buildEntityTable("dsqa-memo", memoEntity), [
      { tenantId, unitId: A1 },
      { tenantId, unitId: A1 },
    ]);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("a label target hidden by the ownership rule stays unnamed", async () => {
    const asTeam = await list({}, teamA);
    // The unit the newest issue points at belongs to team b, which team a cannot read.
    expect(cellOf(asTeam, A1, "assigneeLabel")).toBeNull();

    const asAdmin = await list({}, admin);
    expect(cellOf(asAdmin, A1, "assigneeLabel")).toBe("Secret-B");
  });

  test("count leaves out child rows the ownership rule hides", async () => {
    expect(cellOf(await list({}, teamA), A1, "issueCount")).toBe(2);
    expect(cellOf(await list({}, admin), A1, "issueCount")).toBe(3);
  });

  test("an unreadable on.outer or where field yields NULL", async () => {
    const asTeam = await list({}, teamA);
    expect(cellOf(asTeam, A1, "viaSecret")).toBeNull();
    expect(cellOf(asTeam, A1, "noted")).toBeNull();

    const asAdmin = await list({}, admin);
    expect(cellOf(asAdmin, A1, "viaSecret")).toBe(3);
    expect(cellOf(asAdmin, A1, "noted")).toBe(2);
  });

  test("a gated sortable value does not order the list", async () => {
    const asTeam = await list({ sort: "noted", sortDirection: "desc" }, teamA);
    expect(ids(asTeam)).toEqual([A1, A2]);
  });

  test("an entity no query handler lets the role read yields NULL", async () => {
    const asTeam = await list({ sort: "memoCount", sortDirection: "desc" }, teamA);
    expect(cellOf(asTeam, A1, "memoCount")).toBeNull();
    expect(ids(asTeam)).toEqual([A1, A2]);

    expect(cellOf(await list({}, admin), A1, "memoCount")).toBe(2);
  });

  test("an unknown or non-sortable sort name keeps id order", async () => {
    for (const sort of ["doesNotExist", "viaSecret"]) {
      const page = await list({ sort, sortDirection: "desc" }, admin);
      expect(ids(page)).toEqual([A1, A2, B1]);
    }
  });
});

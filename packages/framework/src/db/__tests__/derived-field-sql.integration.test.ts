// SQL derived fields (`related` measures) in the list query: computed in the SELECT as the
// viewer, sortable with a keyset cursor, never cached. The fixture pins orderings that differ
// from plain id order so a passing sort assertion can only come from the derived value.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createDateField,
  createDerivedField,
  createEntity,
  createNumberField,
  createTextField,
  createTimestampField,
  defineFeature,
} from "../../engine/index.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { buildEntityTable } from "../table-builder.ts";

const contactEntity = createEntity({
  table: "dsql_contacts",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});

const issueEntity = createEntity({
  table: "dsql_issues",
  softDelete: true,
  fields: {
    unitId: { type: "reference", entity: "dsql-unit" },
    status: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    openedOn: createDateField({ required: true }),
    assigneeId: { type: "reference", entity: "dsql-contact", labelField: "name" },
  },
  access: { read: { Admin: "all", User: "all" } },
  indexes: [{ columns: ["unitId"] }],
});

const leaseEntity = createEntity({
  table: "dsql_leases",
  fields: {
    unitRef: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    tenantName: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    startsOn: createDateField({ required: true }),
    endsOn: createDateField(),
  },
  indexes: [{ columns: ["unitRef"] }],
});

const noteEntity = createEntity({
  table: "dsql_notes",
  fields: {
    unitId: { type: "reference", entity: "dsql-unit" },
    body: createTextField({
      required: true,
      personal: false,
      reason: "test_fixture",
      access: { read: { Admin: "all" } },
    }),
    writtenAt: createTimestampField({ required: true }),
  },
  indexes: [{ columns: ["unitId"] }],
});

// Readable by Admin only: a User must see NULL for every field measured on it.
const adminOnlyRemarkEntity = createEntity({
  table: "dsql_remarks",
  fields: { unitId: { type: "reference", entity: "dsql-unit" } },
  access: { read: { Admin: "all" } },
  indexes: [{ columns: ["unitId"] }],
});

const unitEntity = createEntity({
  table: "dsql_units",
  fields: {
    name: createTextField({
      required: true,
      searchable: true,
      personal: false,
      reason: "test_fixture",
    }),
    region: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    floor: createNumberField(),
  },
  derivedFields: {
    openIssues: createDerivedField({
      valueType: "number",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsql:dsql-issue",
        on: { field: "unitId" },
        measure: { kind: "count" },
        where: [{ field: "status", op: "in", value: ["open", "wip"] }],
      },
    }),
    activeTenants: createDerivedField({
      valueType: "number",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsql-lease",
        on: { field: "unitRef" },
        measure: { kind: "countDistinct", field: "tenantName" },
        where: [{ activeOn: { from: "startsOn", to: "endsOn" } }],
      },
    }),
    latestNote: createDerivedField({
      valueType: "text",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsql-note",
        on: { field: "unitId" },
        measure: { kind: "first", field: "body", orderBy: "writtenAt", direction: "desc" },
      },
    }),
    latestAssignee: createDerivedField({
      valueType: "text",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsql-issue",
        on: { field: "unitId" },
        measure: {
          kind: "first",
          field: "assigneeId",
          orderBy: "openedOn",
          direction: "desc",
          label: true,
        },
      },
    }),
    remarkCount: createDerivedField({
      valueType: "number",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsql-remark",
        on: { field: "unitId" },
        measure: { kind: "count" },
      },
    }),
    unsortableCount: createDerivedField({
      valueType: "number",
      sql: {
        kind: "related",
        entity: "dsql-issue",
        on: { field: "unitId" },
        measure: { kind: "count" },
      },
    }),
  },
});

const feature = defineFeature("dsql", (r) => {
  const access = { roles: ["Admin", "User"] };
  r.crud("dsql-contact", contactEntity, { write: { access }, read: { access } });
  r.crud("dsql-issue", issueEntity, { write: { access }, read: { access } });
  r.crud("dsql-lease", leaseEntity, { write: { access }, read: { access } });
  r.crud("dsql-note", noteEntity, { write: { access }, read: { access } });
  r.crud("dsql-remark", adminOnlyRemarkEntity, { write: { access }, read: { access } });
  r.crud("dsql-unit", unitEntity, { write: { access }, read: { access } });
});

const LIST = "dsql:query:dsql-unit:list";
const admin = TestUsers.admin;
const otherTenant = TestUsers.otherTenant;

const uid = (n: number): string =>
  `00000000-0000-4000-8000-0000000000${n.toString().padStart(2, "0")}`;
const U1 = uid(1);
const U2 = uid(2);
const U3 = uid(3);
const U4 = uid(4);
const U5 = uid(5);
const U6 = uid(6);
const ANNA = uid(21);
const MIKE = uid(22);
const ZOE = uid(23);

type Page = {
  readonly rows: readonly Record<string, unknown>[];
  readonly nextCursor: string | null;
  readonly total?: number;
};

describe("SQL derived fields (related)", () => {
  let stack: TestStack;
  let today = "2026-06-15";

  const list = (payload: Record<string, unknown>, user: SessionUser = admin): Promise<Page> =>
    stack.http.queryOk<Page>(LIST, payload, user);
  const ids = (page: Page): unknown[] => page.rows.map((row) => row["id"]);
  const valuesOf = (page: Page, field: string): unknown[] => page.rows.map((row) => row[field]);

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [feature],
      extraContext: {
        clock: { now: () => Temporal.Instant.from(`${today}T12:00:00Z`) },
      },
    });
    for (const [entity, name] of [
      [contactEntity, "dsql-contact"],
      [issueEntity, "dsql-issue"],
      [leaseEntity, "dsql-lease"],
      [noteEntity, "dsql-note"],
      [adminOnlyRemarkEntity, "dsql-remark"],
      [unitEntity, "dsql-unit"],
    ] as const) {
      await unsafeCreateEntityTable(stack.db, entity, name);
    }

    const tenantId = admin.tenantId;
    await seedRows(stack.db, buildEntityTable("dsql-contact", contactEntity), [
      { id: ANNA, tenantId, name: "Anna" },
      { id: MIKE, tenantId, name: "Mike" },
      { id: ZOE, tenantId, name: "Zoe" },
    ]);
    await seedRows(stack.db, buildEntityTable("dsql-unit", unitEntity), [
      { id: U1, tenantId, name: "Alpha", region: "N" },
      { id: U2, tenantId, name: "Beta", region: "N" },
      { id: U3, tenantId, name: "Gamma", region: "N" },
      { id: U4, tenantId, name: "Delta", region: "N" },
      { id: U5, tenantId, name: "Epsilon", region: "N" },
      { id: U6, tenantId, name: "Zeta", region: "S" },
    ]);
    for (const [entityId, name] of [
      [U1, "Alpha"],
      [U2, "Beta"],
      [U3, "Gamma"],
      [U4, "Delta"],
      [U5, "Epsilon"],
      [U6, "Zeta"],
    ] as const) {
      await stack.search.index(tenantId, {
        entityType: "dsql-unit",
        entityId,
        weight: 1,
        fields: { name },
      });
    }
    await seedRows(
      stack.db,
      buildEntityTable("dsql-issue", issueEntity),
      [
        { tenantId, unitId: U1, status: "open", openedOn: "2026-01-01", assigneeId: MIKE },
        { tenantId, unitId: U1, status: "wip", openedOn: "2026-02-01", assigneeId: ANNA },
        { tenantId, unitId: U1, status: "closed", openedOn: "2025-01-01", assigneeId: null },
        { tenantId, unitId: U2, status: "open", openedOn: "2026-03-01", assigneeId: ZOE },
        { tenantId, unitId: U3, status: "closed", openedOn: "2025-06-01", assigneeId: null },
        { tenantId, unitId: U4, status: "open", openedOn: "2026-04-01", assigneeId: MIKE },
        { tenantId, unitId: U4, status: "open", openedOn: "2026-05-01", assigneeId: null },
        // Soft-deleted and foreign-tenant children must count and label nothing.
        {
          tenantId,
          unitId: U4,
          status: "open",
          openedOn: "2026-12-01",
          assigneeId: ZOE,
          isDeleted: true,
        },
        {
          tenantId: otherTenant.tenantId,
          unitId: U4,
          status: "open",
          openedOn: "2026-11-01",
          assigneeId: null,
        },
      ].map((row) => ({ isDeleted: false, ...row })),
    );
    await seedRows(stack.db, buildEntityTable("dsql-lease", leaseEntity), [
      { tenantId, unitRef: U1, tenantName: "A", startsOn: "2026-01-01", endsOn: null },
      { tenantId, unitRef: U1, tenantName: "A", startsOn: "2026-03-01", endsOn: null },
      { tenantId, unitRef: U1, tenantName: "B", startsOn: "2025-01-01", endsOn: "2025-12-31" },
      { tenantId, unitRef: U2, tenantName: "C", startsOn: "2026-07-01", endsOn: null },
      { tenantId, unitRef: U4, tenantName: "D", startsOn: "2026-01-01", endsOn: "2026-06-15" },
      { tenantId, unitRef: U4, tenantName: "E", startsOn: "2026-02-01", endsOn: "2026-12-31" },
    ]);
    await seedRows(stack.db, buildEntityTable("dsql-note", noteEntity), [
      { tenantId, unitId: U1, body: "Alfa", writtenAt: "2026-01-01T00:00:00Z" },
      { tenantId, unitId: U1, body: "Yankee", writtenAt: "2026-03-01T00:00:00Z" },
      { tenantId, unitId: U2, body: "Bravo", writtenAt: "2026-02-01T00:00:00Z" },
    ]);
    await seedRows(stack.db, buildEntityTable("dsql-remark", adminOnlyRemarkEntity), [
      { tenantId, unitId: U1 },
      { tenantId, unitId: U1 },
      { tenantId, unitId: U3 },
    ]);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("count honours the where, skips soft-deleted and foreign-tenant children", async () => {
    const page = await list({ sort: "openIssues", sortDirection: "asc", limit: 10 });
    const byId = new Map(page.rows.map((row) => [row["id"], row["openIssues"]]));

    expect(byId.get(U1)).toBe(2);
    expect(byId.get(U2)).toBe(1);
    expect(byId.get(U3)).toBe(0);
    expect(byId.get(U4)).toBe(2);
    expect(byId.get(U5)).toBe(0);
  });

  test("sorts by the derived value in both directions, ties by id", async () => {
    const asc = await list({
      filter: { field: "region", op: "eq", value: "N" },
      sort: "openIssues",
      sortDirection: "asc",
    });
    expect(ids(asc)).toEqual([U3, U5, U2, U1, U4]);

    const desc = await list({
      filter: { field: "region", op: "eq", value: "N" },
      sort: "openIssues",
      sortDirection: "desc",
    });
    expect(ids(desc)).toEqual([U1, U4, U2, U3, U5]);
  });

  test("countDistinct with activeOn follows the injected clock; the text foreign key joins", async () => {
    today = "2026-06-15";
    const now = await list({ limit: 10 });
    const activeNow = new Map(now.rows.map((row) => [row["id"], row["activeTenants"]]));
    expect([activeNow.get(U1), activeNow.get(U2), activeNow.get(U3), activeNow.get(U4)]).toEqual([
      1, 0, 0, 2,
    ]);

    today = "2026-08-01";
    const later = await list({ limit: 10 });
    const activeLater = new Map(later.rows.map((row) => [row["id"], row["activeTenants"]]));
    expect([
      activeLater.get(U1),
      activeLater.get(U2),
      activeLater.get(U3),
      activeLater.get(U4),
    ]).toEqual([1, 1, 0, 1]);
    today = "2026-06-15";
  });

  test("first picks the newest child; NULLs sort last ascending and first descending", async () => {
    const asc = await list({ sort: "latestNote", sortDirection: "asc", limit: 10 });
    expect(ids(asc).slice(0, 2)).toEqual([U2, U1]);
    expect(valuesOf(asc, "latestNote").slice(0, 2)).toEqual(["Bravo", "Yankee"]);
    expect(valuesOf(asc, "latestNote").slice(2)).toEqual([null, null, null, null]);

    const desc = await list({ sort: "latestNote", sortDirection: "desc", limit: 10 });
    expect(valuesOf(desc, "latestNote").slice(0, 4)).toEqual([null, null, null, null]);
    expect(ids(desc).slice(4)).toEqual([U1, U2]);
  });

  test("first with label yields the referenced row's label, ignoring deleted children", async () => {
    const page = await list({ limit: 10 });
    const byId = new Map(page.rows.map((row) => [row["id"], row["latestAssignee"]]));

    expect(byId.get(U1)).toBe("Anna");
    expect(byId.get(U2)).toBe("Zoe");
    expect(byId.get(U3)).toBeNull();
    expect(byId.get(U4)).toBeNull();
  });

  test("page 2 through nextCursor keeps search, filter and the derived order exact", async () => {
    const base = {
      search: "a",
      filter: { field: "region", op: "eq", value: "N" },
      sort: "openIssues",
      sortDirection: "asc",
      limit: 3,
      totalCount: true,
    };
    const page1 = await list(base);
    expect(ids(page1)).toEqual([U3, U2, U1]);
    expect(page1.total).toBe(4);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await list({ ...base, cursor: page1.nextCursor });
    expect(ids(page2)).toEqual([U4]);
    expect(page2.total).toBe(1);
  });

  test("totalCount stays correct with derived fields present", async () => {
    const page = await list({ limit: 2, totalCount: true });

    expect(page.total).toBe(6);
    expect(page.rows).toHaveLength(2);
  });

  test("a field that is not sortable keeps id order", async () => {
    const page = await list({ sort: "unsortableCount", sortDirection: "desc", limit: 10 });

    expect(ids(page)).toEqual([U1, U2, U3, U4, U5, U6]);
  });

  describe("access", () => {
    test("a role without read access to the child entity gets NULL and id order", async () => {
      const asUser = await list(
        { sort: "remarkCount", sortDirection: "desc", limit: 10 },
        TestUsers.user,
      );
      expect(valuesOf(asUser, "remarkCount")).toEqual([null, null, null, null, null, null]);
      expect(ids(asUser)).toEqual([U1, U2, U3, U4, U5, U6]);

      const asAdmin = await list({ sort: "remarkCount", sortDirection: "desc", limit: 10 });
      expect(valuesOf(asAdmin, "remarkCount").slice(0, 2)).toEqual([2, 1]);
      expect(ids(asAdmin).slice(0, 2)).toEqual([U1, U3]);
    });

    test("a role without read access to the measured field gets NULL and id order", async () => {
      const asUser = await list(
        { sort: "latestNote", sortDirection: "asc", limit: 10 },
        TestUsers.user,
      );
      expect(valuesOf(asUser, "latestNote")).toEqual([null, null, null, null, null, null]);
      expect(ids(asUser)).toEqual([U1, U2, U3, U4, U5, U6]);

      const asAdmin = await list({ sort: "latestNote", sortDirection: "asc", limit: 10 });
      expect(ids(asAdmin).slice(0, 2)).toEqual([U2, U1]);
    });

    test("a viewer with access is not served another viewer's cached NULLs", async () => {
      await list({ limit: 10 }, TestUsers.user);
      const asAdmin = await list({ limit: 10 });

      expect(asAdmin.rows.find((row) => row["id"] === U1)?.["latestNote"]).toBe("Yankee");
    });
  });
});

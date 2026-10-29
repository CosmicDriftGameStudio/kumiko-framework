// Tables a SQL derived field (and its label lookup) has to find: an entity with a
// backingTable is read from that table, and an entity may derive from itself.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createDerivedField,
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineFeature,
} from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { buildEntityTable } from "../table-builder.ts";

const fixture = { personal: false, reason: "test_fixture" } as const;

// The entity's own `table` names a table that does not exist: rows live in the backing table.
const personEntity = createEntity({
  table: "dsqb_people",
  fields: { name: createTextField({ required: true, ...fixture }) },
});
const personBacking = { ...personEntity, table: "dsqb_people_backing" };
const personTable = buildEntityTable("person", personBacking);

const jobEntity = createEntity({
  table: "dsqb_jobs",
  fields: {
    crewId: { type: "reference", entity: "crew" },
    leadId: {
      type: "reference",
      entity: "person",
      labelField: "name",
      searchable: true,
      sortable: true,
    },
  },
  indexes: [{ columns: ["crewId"] }],
});
const jobBacking = { ...jobEntity, table: "dsqb_jobs_backing" };
const jobTable = buildEntityTable("job", jobBacking);

const crewEntity = createEntity({
  table: "dsqb_crews",
  fields: {
    name: createTextField({ required: true, ...fixture }),
    parentCrewId: { type: "reference", entity: "crew" },
  },
  indexes: [{ columns: ["parentCrewId"] }],
  derivedFields: {
    jobCount: createDerivedField({
      valueType: "number",
      sortable: true,
      sql: {
        kind: "related",
        entity: "job",
        on: { field: "crewId" },
        measure: { kind: "count" },
      },
    }),
    leadName: createDerivedField({
      valueType: "text",
      sql: {
        kind: "related",
        entity: "job",
        on: { field: "crewId" },
        measure: { kind: "first", field: "leadId", orderBy: "id", direction: "asc", label: true },
      },
    }),
    subCrews: createDerivedField({
      valueType: "number",
      sortable: true,
      sql: {
        kind: "related",
        entity: "crew",
        on: { field: "parentCrewId" },
        measure: { kind: "count" },
      },
    }),
  },
});

const feature = defineFeature("dsqb", (r) => {
  const access = { roles: ["Admin"] };
  r.entity({ name: "person", ...personEntity, backingTable: personTable });
  r.entity({ name: "job", ...jobEntity, backingTable: jobTable });
  r.entity({ name: "crew", ...crewEntity });
  for (const [name, entity] of [
    ["person", personBacking],
    ["job", jobBacking],
    ["crew", crewEntity],
  ] as const) {
    r.queryHandler(defineEntityQueryHandler(`${name}:list`, entity, { access }));
  }
});

const admin = TestUsers.admin;
const uid = (n: number): string =>
  `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const C1 = uid(1);
const C2 = uid(2);
const J1 = uid(11);
const J2 = uid(12);
const ZED = uid(21);
const PIA = uid(22);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

type Page = { readonly rows: readonly Record<string, unknown>[] };

describe("derived fields over backing tables and self-relations", () => {
  let stack: TestStack;
  const list = (entity: string, payload: Record<string, unknown>): Promise<Page> =>
    stack.http.queryOk<Page>(`dsqb:query:${entity}:list`, { limit: 10, ...payload }, admin);

  beforeAll(async () => {
    stack = await setupTestStack({ features: [feature] });
    await unsafeCreateEntityTable(stack.db, personBacking, "person");
    await unsafeCreateEntityTable(stack.db, jobBacking, "job");
    await unsafeCreateEntityTable(stack.db, crewEntity, "crew");
    const tenantId = admin.tenantId;
    await seedRows(stack.db, personTable, [
      { id: ZED, tenantId, name: "Zed" },
      { id: PIA, tenantId, name: "Pia" },
    ]);
    await seedRows(stack.db, buildEntityTable("crew", crewEntity), [
      { id: C1, tenantId, name: "Crew 1", parentCrewId: null },
      { id: C2, tenantId, name: "Crew 2", parentCrewId: C1 },
    ]);
    await seedRows(stack.db, jobTable, [
      { id: J1, tenantId, crewId: C1, leadId: ZED },
      { id: J2, tenantId, crewId: C2, leadId: PIA },
    ]);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("count and label read the related entity's backing table", async () => {
    const rows = (await list("crew", {})).rows;

    expect(rows.find((row) => row["id"] === C1)).toMatchObject({ jobCount: 1, leadName: "Zed" });
    expect(rows.find((row) => row["id"] === C2)).toMatchObject({ jobCount: 1, leadName: "Pia" });
  });

  test("a reference to a backingTable entity gets its label, search and sort", async () => {
    const labelOf = (rows: readonly Record<string, unknown>[], id: string): unknown => {
      const refs = rows.find((row) => row["id"] === id)?.["_refs"];
      const lead = isRecord(refs) ? refs["leadId"] : undefined;
      return isRecord(lead) ? lead["name"] : undefined;
    };
    const plain = (await list("job", {})).rows;
    expect([labelOf(plain, J1), labelOf(plain, J2)]).toEqual(["Zed", "Pia"]);

    const found = await list("job", { search: "Pia" });
    expect(found.rows.map((row) => row["id"])).toEqual([J2]);

    const sorted = await list("job", { sort: "leadId", sortDirection: "asc" });
    expect(sorted.rows.map((row) => row["id"])).toEqual([J2, J1]);
  });

  test("an entity derives from itself and orders by it", async () => {
    const desc = await list("crew", { sort: "subCrews", sortDirection: "desc" });

    expect(desc.rows.map((row) => [row["id"], row["subCrews"]])).toEqual([
      [C1, 1],
      [C2, 0],
    ]);
  });
});

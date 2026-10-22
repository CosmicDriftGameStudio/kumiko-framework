import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createEventStoreExecutor } from "../db/event-store-executor.ts";
import { selectMany } from "../db/query.ts";
import { seedReferenceData } from "../db/reference-data.ts";
import { buildEntityTable } from "../db/table-builder.ts";
import { createTenantDb } from "../db/tenant-db.ts";
import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
  type ReferenceDataDef,
} from "../engine/index.ts";
import { createSystemUser } from "../engine/system-user.ts";
import { type EntityId, SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { rebuildProjection } from "../pipeline/index.ts";

const refField = { personal: false, reason: "is_reference_data" } as const;

const countryEntity = createEntity({
  table: "ref_countries",
  fields: {
    code: createTextField({ ...refField, required: true }),
    name: createTextField({ ...refField, required: true }),
    region: createTextField(refField),
  },
});
const statusEntity = createEntity({
  table: "ref_statuses",
  fields: {
    slug: createTextField({ ...refField, required: true }),
    label: createTextField({ ...refField, required: true }),
    sortOrder: createNumberField(refField),
  },
});
const tagEntity = createEntity({
  table: "ref_tags",
  fields: { slug: createTextField({ ...refField, required: true }) },
  softDelete: true,
});
const tagTable = buildEntityTable("tag", tagEntity);
const countryTable = buildEntityTable("country", countryEntity);
const statusTable = buildEntityTable("status", statusEntity);

const feature = defineFeature("refdata", (r) => {
  r.entity({ name: "country", ...countryEntity });
  r.entity({ name: "status", ...statusEntity });
  r.entity({ name: "tag", ...tagEntity });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, countryEntity, "country");
  await unsafeCreateEntityTable(stack.db, statusEntity, "status");
  await unsafeCreateEntityTable(stack.db, tagEntity, "tag");
});

afterAll(async () => {
  await stack?.cleanup();
});

async function readCountries() {
  const rows = await selectMany(stack.db, countryTable);
  return rows.toSorted((a, b) => String(a["code"]).localeCompare(String(b["code"])));
}

async function readStatuses() {
  const rows = await selectMany(stack.db, statusTable);
  return rows.toSorted((a, b) => Number(a["sortOrder"] ?? 0) - Number(b["sortOrder"] ?? 0));
}

describe("seedReferenceData", () => {
  test("inserts initial reference data", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [
          { code: "DE", name: "Deutschland", region: "Europe" },
          { code: "AT", name: "Oesterreich", region: "Europe" },
          { code: "JP", name: "Japan", region: "Asia" },
        ],
      },
    ];

    const result = await seedReferenceData(defs, stack.registry, stack.db);

    expect(result).toEqual({ inserted: 3, updated: 0 });

    const rows = await readCountries();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ code: "AT", name: "Oesterreich", region: "Europe" });
    expect(rows[1]).toMatchObject({ code: "DE", name: "Deutschland", region: "Europe" });
    expect(rows[2]).toMatchObject({ code: "JP", name: "Japan", region: "Asia" });
  });

  test("is idempotent — no-op when data unchanged", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [
          { code: "DE", name: "Deutschland", region: "Europe" },
          { code: "AT", name: "Oesterreich", region: "Europe" },
          { code: "JP", name: "Japan", region: "Asia" },
        ],
      },
    ];

    const result = await seedReferenceData(defs, stack.registry, stack.db);

    expect(result).toEqual({ inserted: 0, updated: 0 });

    // Data still the same
    const rows = await readCountries();
    expect(rows).toHaveLength(3);
  });

  test("updates changed fields without duplicating rows", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [
          { code: "DE", name: "Germany", region: "Europe" }, // name changed
          { code: "AT", name: "Oesterreich", region: "Europe" }, // unchanged
          { code: "JP", name: "Japan", region: "East Asia" }, // region changed
        ],
      },
    ];

    const result = await seedReferenceData(defs, stack.registry, stack.db);

    expect(result).toEqual({ inserted: 0, updated: 2 });

    const rows = await readCountries();
    expect(rows).toHaveLength(3); // no duplicates
    expect(rows[1]).toMatchObject({ code: "DE", name: "Germany", region: "Europe" });
    expect(rows[2]).toMatchObject({ code: "JP", name: "Japan", region: "East Asia" });
  });

  test("inserts new rows alongside existing ones", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [
          { code: "DE", name: "Germany", region: "Europe" },
          { code: "CH", name: "Schweiz", region: "Europe" }, // new
        ],
      },
    ];

    const result = await seedReferenceData(defs, stack.registry, stack.db);

    expect(result).toEqual({ inserted: 1, updated: 0 });

    const rows = await readCountries();
    expect(rows).toHaveLength(4);
    expect(rows.find((r: Record<string, unknown>) => r["code"] === "CH")).toMatchObject({
      name: "Schweiz",
      region: "Europe",
    });
  });

  test("custom upsertKey — matches on specified field instead of first", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "status",
        data: [
          { slug: "draft", label: "Draft", sortOrder: 1 },
          { slug: "active", label: "Active", sortOrder: 2 },
          { slug: "archived", label: "Archived", sortOrder: 3 },
        ],
        upsertKey: "slug",
      },
    ];

    const result = await seedReferenceData(defs, stack.registry, stack.db);
    expect(result).toEqual({ inserted: 3, updated: 0 });

    // Update label via same upsertKey
    const updateDefs: ReferenceDataDef[] = [
      {
        entityName: "status",
        data: [
          { slug: "draft", label: "Entwurf", sortOrder: 1 }, // label changed
          { slug: "active", label: "Active", sortOrder: 2 }, // unchanged
        ],
        upsertKey: "slug",
      },
    ];

    const updateResult = await seedReferenceData(updateDefs, stack.registry, stack.db);
    expect(updateResult).toEqual({ inserted: 0, updated: 1 });

    const rows = await readStatuses();
    expect(rows.find((r: Record<string, unknown>) => r["slug"] === "draft")).toMatchObject({
      label: "Entwurf",
    });
    expect(rows.find((r: Record<string, unknown>) => r["slug"] === "active")).toMatchObject({
      label: "Active",
    });
    expect(rows.find((r: Record<string, unknown>) => r["slug"] === "archived")).toMatchObject({
      label: "Archived",
    });
  });

  test("skips unknown entity names gracefully", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "nonexistent",
        data: [{ code: "X", name: "Unknown" }],
      },
    ];

    const result = await seedReferenceData(defs, stack.registry, stack.db);
    expect(result).toEqual({ inserted: 0, updated: 0 });
  });

  test("stamps the system tenant and version 1 on insert, and the rows survive a rebuild", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "status",
        data: [{ slug: "pending", label: "Pending", sortOrder: 9 }],
        upsertKey: "slug",
      },
    ];

    expect(await seedReferenceData(defs, stack.registry, stack.db)).toEqual({
      inserted: 1,
      updated: 0,
    });

    const before = (await readStatuses()).filter((r) => r["slug"] === "pending");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ tenantId: SYSTEM_TENANT_ID, version: 1, label: "Pending" });

    await rebuildProjection("refdata:projection:status-entity", {
      db: stack.db,
      registry: stack.registry,
    });
    await rebuildProjection("refdata:projection:country-entity", {
      db: stack.db,
      registry: stack.registry,
    });

    const after = await readStatuses();
    expect(after.filter((r) => r["slug"] === "pending")).toHaveLength(1);
    expect(after.find((r) => r["slug"] === "draft")).toMatchObject({ label: "Entwurf" });
    const countries = await readCountries();
    expect(countries.find((r) => r["code"] === "DE")).toMatchObject({ name: "Germany" });
    expect(countries.find((r) => r["code"] === "CH")).toMatchObject({ name: "Schweiz" });
  });

  test("re-creates a soft-deleted row instead of failing the boot", async () => {
    const defs: ReferenceDataDef[] = [{ entityName: "tag", data: [{ slug: "hot" }] }];
    expect(await seedReferenceData(defs, stack.registry, stack.db)).toEqual({
      inserted: 1,
      updated: 0,
    });

    const [row] = await selectMany(stack.db, tagTable);
    const systemUser = createSystemUser(SYSTEM_TENANT_ID);
    const executor = createEventStoreExecutor(tagTable, tagEntity, { entityName: "tag" });
    const deleted = await executor.delete(
      { id: String(row?.["id"]) as EntityId },
      systemUser,
      createTenantDb({ db: stack.db, tenantId: SYSTEM_TENANT_ID, mode: "system" }),
    );
    expect(deleted.isSuccess).toBe(true);

    expect(await seedReferenceData(defs, stack.registry, stack.db)).toEqual({
      inserted: 1,
      updated: 0,
    });
    const live = (await selectMany(stack.db, tagTable)).filter((r) => r["isDeleted"] === false);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ slug: "hot", tenantId: SYSTEM_TENANT_ID });
  });

  test("skips empty data arrays", async () => {
    const defs: ReferenceDataDef[] = [
      {
        entityName: "country",
        data: [],
      },
    ];

    const result = await seedReferenceData(defs, stack.registry, stack.db);
    expect(result).toEqual({ inserted: 0, updated: 0 });
  });
});

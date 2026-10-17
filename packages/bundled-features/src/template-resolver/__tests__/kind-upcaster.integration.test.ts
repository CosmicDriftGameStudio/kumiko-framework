import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createRegistry,
  createSelectField,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createProjectionStateTable,
  rebuildProjection,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { TEMPLATE_KINDS } from "../constants.js";
import { createTemplateResolverFeature } from "../feature.js";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.js";

// Stored v1 events say kind "mail-html"; the v2 definition must read them as "mail".
const entityV1 = createEntity({
  table: "read_template_resources",
  fields: {
    ...templateResourceEntity.fields,
    kind: createSelectField({ required: true, options: [...TEMPLATE_KINDS, "mail-html"] }),
  },
  indexes: templateResourceEntity.indexes,
});

const admin = TestUsers.admin;
let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, templateResourceEntity);
  await createProjectionStateTable(testDb.db);
});

afterEach(async () => {
  await testDb.cleanup();
});

describe("template-resource kind upcaster (v1 -> v2)", () => {
  test("rebuild reads created and updated mail-html events as kind mail", async () => {
    const executorV1 = createEventStoreExecutor(templateResourcesTable, entityV1, {
      entityName: "template-resource",
    });
    const tdb = createTenantDb(testDb.db, admin.tenantId);
    const created = await executorV1.create(
      {
        slug: "legacy-welcome",
        kind: "mail-html",
        locale: "de",
        content: "<p>v1</p>",
        contentFormat: "html",
        variableSchema: "{}",
        linkedResources: "{}",
        scope: "tenant",
        status: "draft",
      },
      admin,
      tdb,
    );
    expect(created.isSuccess).toBe(true);
    const id = created.isSuccess ? String(created.data["id"]) : "";
    const updated = await executorV1.update(
      { id, version: 1, changes: { kind: "mail-html", content: "<p>v2</p>" } },
      admin,
      tdb,
    );
    expect(updated.isSuccess).toBe(true);

    await rebuildProjection("template-resolver:projection:template-resource-entity", {
      db: testDb.db,
      registry: createRegistry([createTemplateResolverFeature()]),
    });

    const rows = await selectMany<TemplateResourceRow>(testDb.db, templateResourcesTable, {
      slug: "legacy-welcome",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "mail", content: "<p>v2</p>" });
  });
});

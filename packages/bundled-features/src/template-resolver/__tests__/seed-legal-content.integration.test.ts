import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID, SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { TEXT_BLOCK_KIND } from "../constants";
import { createTemplateResolverFeature } from "../feature";
import { type LegalContentBlock, seedLegalContentFromJson } from "../seeding";
import { type TemplateResourceRow, templateResourceEntity, templateResourcesTable } from "../table";

// Pins seedLegalContentFromJson: seeds into SYSTEM_TENANT_ID by default and
// re-seeds with ifExists:"update" so a changed template body lands on an
// already-seeded block (legal-drift guard — the load-bearing behaviour).

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTemplateResolverFeature()] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

function read(slug: string, locale: string) {
  return fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug,
    kind: TEXT_BLOCK_KIND,
    locale,
  });
}

describe("seedLegalContentFromJson", () => {
  test("seeds all blocks into SYSTEM_TENANT_ID as SYSTEM_USER", async () => {
    const blocks: LegalContentBlock[] = [
      { slug: "imprint", locale: "de", title: "Impressum", content: "Marc Frost" },
      { slug: "imprint", locale: "en", title: "Imprint", content: "Marc Frost" },
    ];
    await seedLegalContentFromJson(db, blocks);

    const de = (await read("imprint", "de")) as TemplateResourceRow & {
      insertedById: string;
      modifiedById: string | null;
    };
    expect(de).toMatchObject({ title: "Impressum", content: "Marc Frost" });
    expect(de.insertedById).toBe(SYSTEM_USER_ID);
    expect(await read("imprint", "en")).toMatchObject({ title: "Imprint", content: "Marc Frost" });
  });

  test("re-seed lifts an existing block to the new template state (ifExists:update)", async () => {
    const v1: LegalContentBlock[] = [
      { slug: "privacy", locale: "de", title: "Datenschutz", content: "v1" },
    ];
    await seedLegalContentFromJson(db, v1);
    expect(await read("privacy", "de")).toMatchObject({ content: "v1" });

    const v2: LegalContentBlock[] = [
      {
        slug: "privacy",
        locale: "de",
        title: "Datenschutz",
        content: "v2 + Sub-Processor-Tabelle",
      },
    ];
    await seedLegalContentFromJson(db, v2);
    const row = (await read("privacy", "de")) as TemplateResourceRow & { modifiedById: string };
    expect(row).toMatchObject({ content: "v2 + Sub-Processor-Tabelle" });
    expect(row.modifiedById).toBe(SYSTEM_USER_ID);
  });

  test("identical re-seed is a no-op (no update event, version/modifiedAt stable)", async () => {
    const blocks: LegalContentBlock[] = [
      { slug: "terms", locale: "de", title: "AGB", content: "stable" },
    ];
    await seedLegalContentFromJson(db, blocks);
    const before = (await read("terms", "de")) as TemplateResourceRow & {
      modifiedAt: unknown;
    };
    expect(before).not.toBeNull();

    await seedLegalContentFromJson(db, blocks);
    const after = (await read("terms", "de")) as TemplateResourceRow & { modifiedAt: unknown };
    expect(after.version).toBe(before.version);
    expect(after.content).toBe("stable");
    expect(after.modifiedAt).toEqual(before.modifiedAt);

    const events = await selectMany(db, eventsTable, { aggregateId: String(before.id) });
    expect(events.map((e) => e.type)).toEqual(["template-resource.created"]);
  });
});

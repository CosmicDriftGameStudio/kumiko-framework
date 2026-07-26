import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID, SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTextContentFeature } from "../feature";
import { type LegalContentBlock, seedLegalContentFromJson } from "../seeding";
import { type TextBlockRow, textBlockEntity, textBlocksTable } from "../table";

// Pins seedLegalContentFromJson: seeds into SYSTEM_TENANT_ID by default and
// re-seeds with ifExists:"update" so a changed template body lands on an
// already-seeded block (legal-drift guard — the load-bearing behaviour).

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTextContentFeature()] });
  db = stack.db;
  await unsafeCreateEntityTable(db, textBlockEntity);
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

function read(slug: string, lang: string) {
  return fetchOne<TextBlockRow>(db, textBlocksTable, { tenantId: SYSTEM_TENANT_ID, slug, lang });
}

describe("seedLegalContentFromJson", () => {
  test("seeds all blocks into SYSTEM_TENANT_ID as SYSTEM_USER", async () => {
    const blocks: LegalContentBlock[] = [
      { slug: "imprint", lang: "de", title: "Impressum", body: "Marc Frost" },
      { slug: "imprint", lang: "en", title: "Imprint", body: "Marc Frost" },
    ];
    await seedLegalContentFromJson(db, blocks);

    const de = (await read("imprint", "de")) as TextBlockRow & {
      insertedById: string;
      modifiedById: string | null;
    };
    expect(de).toMatchObject({ title: "Impressum", body: "Marc Frost" });
    expect(de.insertedById).toBe(SYSTEM_USER_ID);
    expect(await read("imprint", "en")).toMatchObject({ title: "Imprint", body: "Marc Frost" });
  });

  test("re-seed lifts an existing block to the new template state (ifExists:update)", async () => {
    const v1: LegalContentBlock[] = [
      { slug: "privacy", lang: "de", title: "Datenschutz", body: "v1" },
    ];
    await seedLegalContentFromJson(db, v1);
    expect(await read("privacy", "de")).toMatchObject({ body: "v1" });

    const v2: LegalContentBlock[] = [
      { slug: "privacy", lang: "de", title: "Datenschutz", body: "v2 + Sub-Processor-Tabelle" },
    ];
    await seedLegalContentFromJson(db, v2);
    const row = (await read("privacy", "de")) as TextBlockRow & { modifiedById: string };
    expect(row).toMatchObject({ body: "v2 + Sub-Processor-Tabelle" });
    expect(row.modifiedById).toBe(SYSTEM_USER_ID);
  });

  test("identical re-seed is a no-op (no update event, version/modifiedAt stable)", async () => {
    const blocks: LegalContentBlock[] = [
      { slug: "terms", lang: "de", title: "AGB", body: "stable" },
    ];
    await seedLegalContentFromJson(db, blocks);
    const before = (await read("terms", "de")) as TextBlockRow & {
      modifiedAt: unknown;
    };
    expect(before).not.toBeNull();

    await seedLegalContentFromJson(db, blocks);
    const after = (await read("terms", "de")) as TextBlockRow & { modifiedAt: unknown };
    expect(after.version).toBe(before.version);
    expect(after.body).toBe("stable");
    expect(after.modifiedAt).toEqual(before.modifiedAt);

    const events = await selectMany(db, eventsTable, { aggregateId: String(before.id) });
    expect(events.map((e) => e.type)).toEqual(["text-block.created"]);
  });
});

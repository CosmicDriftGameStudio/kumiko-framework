import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { setupTestStack, type TestStack, unsafeCreateEntityTable } from "@cosmicdrift/kumiko-framework/stack";
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
  test("seeds all blocks into SYSTEM_TENANT_ID by default", async () => {
    const blocks: LegalContentBlock[] = [
      { slug: "imprint", lang: "de", title: "Impressum", body: "Marc Frost" },
      { slug: "imprint", lang: "en", title: "Imprint", body: "Marc Frost" },
    ];
    await seedLegalContentFromJson(db, blocks);

    expect(await read("imprint", "de")).toMatchObject({ title: "Impressum", body: "Marc Frost" });
    expect(await read("imprint", "en")).toMatchObject({ title: "Imprint", body: "Marc Frost" });
  });

  test("re-seed lifts an existing block to the new template state (ifExists:update)", async () => {
    const v1: LegalContentBlock[] = [{ slug: "privacy", lang: "de", title: "Datenschutz", body: "v1" }];
    await seedLegalContentFromJson(db, v1);
    expect(await read("privacy", "de")).toMatchObject({ body: "v1" });

    const v2: LegalContentBlock[] = [
      { slug: "privacy", lang: "de", title: "Datenschutz", body: "v2 + Sub-Processor-Tabelle" },
    ];
    await seedLegalContentFromJson(db, v2);
    expect(await read("privacy", "de")).toMatchObject({ body: "v2 + Sub-Processor-Tabelle" });
  });
});

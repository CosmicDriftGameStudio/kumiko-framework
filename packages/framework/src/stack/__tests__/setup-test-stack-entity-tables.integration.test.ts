// #3102: setupTestStack pushed projection/MSP/storeTable sources but never
// r.entity() tables, so any feature relying purely on entities crashed on
// first write with 42P01 unless the test manually created the table.

import { afterAll, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { setupTestStack, type TestStack } from "../test-stack";

const widgetEntity = createEntity({
  table: "widgets",
  fields: {
    name: createTextField({ required: true }),
  },
});

const gadgetEntity = createEntity({
  table: "gadgets",
  fields: {
    label: createTextField({ required: true }),
  },
});

const widgetFeature = defineFeature("widget", (r) => {
  r.entity("widget", widgetEntity);
});

const twoEntityFeature = defineFeature("gadgetbox", (r) => {
  r.entity("widget", widgetEntity);
  r.entity("gadget", gadgetEntity);
});

async function tableExistsInInformationSchema(
  db: TestStack["db"],
  tableName: string,
): Promise<boolean> {
  const rows = await asRawClient(db).unsafe<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return rows.length === 1;
}

describe("setupTestStack — r.entity() tables", () => {
  let stack: TestStack | undefined;

  afterAll(async () => {
    await stack?.cleanup();
  });

  test("creates the backing table for a plain r.entity() without manual table setup", async () => {
    stack = await setupTestStack({ features: [widgetFeature] });
    expect(await tableExistsInInformationSchema(stack.db, "widgets")).toBe(true);
  });

  test("creates every entity's backing table when a feature registers more than one", async () => {
    const twoEntityStack = await setupTestStack({ features: [twoEntityFeature] });
    try {
      expect(await tableExistsInInformationSchema(twoEntityStack.db, "widgets")).toBe(true);
      expect(await tableExistsInInformationSchema(twoEntityStack.db, "gadgets")).toBe(true);
    } finally {
      await twoEntityStack.cleanup();
    }
  });
});

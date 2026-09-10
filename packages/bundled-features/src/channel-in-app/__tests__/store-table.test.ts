// Regression test for #missing r.storeTable() registration: inAppMessagesTable
// was declared as a plain pgTable but never registered via r.storeTable(), so
// collectTableMetas() (the source migrations are generated from) never saw
// "in_app_messages" — no migration was ever emitted and every app using
// channel-in-app crashed at runtime with `relation "in_app_messages" does not
// exist`. Mirrors framework/src/engine/__tests__/store-table.test.ts.

import { describe, expect, test } from "bun:test";
import { collectTableMetas } from "@cosmicdrift/kumiko-framework/db";
import { createChannelInAppFeature } from "../feature";

describe("channel-in-app — in_app_messages store table", () => {
  test("registers in_app_messages via r.storeTable", () => {
    const feature = createChannelInAppFeature();
    expect(feature.storeTables).toHaveProperty("in_app_messages");
    expect(feature.storeTables["in_app_messages"]?.meta.tableName).toBe("in_app_messages");
  });

  test("in_app_messages is part of collectTableMetas() so a migration is generated for it", () => {
    const feature = createChannelInAppFeature();
    const metas = collectTableMetas([feature]);
    const tableNames = metas.map((m) => m.tableName);
    expect(tableNames).toContain("in_app_messages");
  });
});

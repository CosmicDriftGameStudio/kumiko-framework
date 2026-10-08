// in_app_messages must be in collectTableMetas() or no migration is generated.

import { describe, expect, test } from "bun:test";
import { collectTableMetas } from "@cosmicdrift/kumiko-framework/db";
import { createChannelInAppFeature } from "../feature.js";

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

  test("in_app_messages carries the tenant + user + created_at index the inbox reads filter on", () => {
    const meta = createChannelInAppFeature().storeTables["in_app_messages"]?.meta;
    expect(meta?.indexes).toContainEqual({
      name: "in_app_messages_tenant_user_created_idx",
      columns: ["tenant_id", "user_id", "created_at"],
    });
  });
});

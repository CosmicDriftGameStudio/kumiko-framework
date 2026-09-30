import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "../../engine/index.js";
import { pushEntityProjectionTables } from "../push-entity-projection-tables.js";
import { setupTestStack } from "../test-stack.js";
import { TestUsers } from "../test-users.js";

function freshDbName(tag: string): string {
  return `kumiko_test_${tag}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

describe("pushEntityProjectionTables — persistent dev DB column sync", () => {
  test("a nullable field added after the first boot is backfilled without manual DDL", async () => {
    const dbName = freshDbName("colsync_nullable");
    const widgetV1 = createEntity({
      table: "colsync_nullable_widgets",
      fields: {
        name: createTextField({ personal: false, reason: "test_fixture", required: true }),
      },
    });
    const v1 = defineFeature("colsync-nullable", (r) => {
      r.entity("widget", widgetV1);
    });
    // Owns the actual DROP DATABASE on cleanup.
    const firstBoot = await setupTestStack({ features: [v1], dbName });
    try {
      await pushEntityProjectionTables(firstBoot, firstBoot.registry);

      const widgetV2 = createEntity({
        table: "colsync_nullable_widgets",
        fields: {
          name: createTextField({ personal: false, reason: "test_fixture", required: true }),
          note: createTextField({ personal: false, reason: "test_fixture" }),
        },
      });
      const v2 = defineFeature("colsync-nullable", (r) => {
        r.entity("widget", widgetV2);
        r.writeHandler(
          defineEntityCreateHandler("widget", widgetV2, { access: { roles: ["Admin"] } }),
        );
      });
      const secondBoot = await setupTestStack({ features: [v2], dbName, persistentDb: true });
      try {
        await pushEntityProjectionTables(secondBoot, secondBoot.registry);
        const created = await secondBoot.http.writeOk<{ data: { note: string } }>(
          "colsync-nullable:write:widget:create",
          { name: "backfilled widget", note: "backfilled via HTTP write" },
          TestUsers.admin,
        );
        expect(created.data.note).toBe("backfilled via HTTP write");
      } finally {
        await secondBoot.cleanup();
      }
    } finally {
      await firstBoot.cleanup();
    }
  });

  test("a required field with no default added after the first boot fails with a clear, actionable error", async () => {
    const dbName = freshDbName("colsync_required");
    const v1 = defineFeature("colsync-required", (r) => {
      r.entity(
        "gadget",
        createEntity({
          table: "colsync_required_gadgets",
          fields: {
            name: createTextField({ personal: false, reason: "test_fixture", required: true }),
          },
        }),
      );
    });
    const firstBoot = await setupTestStack({ features: [v1], dbName });
    try {
      await pushEntityProjectionTables(firstBoot, firstBoot.registry);

      const v2 = defineFeature("colsync-required", (r) => {
        r.entity(
          "gadget",
          createEntity({
            table: "colsync_required_gadgets",
            fields: {
              name: createTextField({ personal: false, reason: "test_fixture", required: true }),
              serial: createTextField({ personal: false, reason: "test_fixture", required: true }),
            },
          }),
        );
      });
      const secondBoot = await setupTestStack({ features: [v2], dbName, persistentDb: true });
      try {
        await expect(pushEntityProjectionTables(secondBoot, secondBoot.registry)).rejects.toThrow(
          /serial.*no default/i,
        );
        await expect(pushEntityProjectionTables(secondBoot, secondBoot.registry)).rejects.toThrow(
          /dropdb/,
        );
      } finally {
        await secondBoot.cleanup();
      }
    } finally {
      await firstBoot.cleanup();
    }
  });
});

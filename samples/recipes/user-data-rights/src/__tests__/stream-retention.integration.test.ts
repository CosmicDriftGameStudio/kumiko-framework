// runStreamRetention is public API: an app test drives the stream pruning with its own `now`
// and checks that the stream and the row of an entity with streamRetention are gone.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createDataRetentionFeature,
  runStreamRetention,
} from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { buildEntityTable, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { previewSnapshotEntity, previewSnapshotsFeature } from "../preview-snapshots";

const CREATE = "preview-snapshots:write:preview-snapshot:create";
const tenantId = testTenantId(62);
const admin = createTestUser({ id: 62, tenantId, roles: ["Admin"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createDataRetentionFeature(), previewSnapshotsFeature],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("user-data-rights recipe :: stream retention prunes short-lived entities", () => {
  test("after keepFor + 1 day the stream and the row are gone", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title: "draft preview" },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    const result = await runStreamRetention({
      db: stack.db,
      registry: stack.registry,
      now: getTemporal()
        .Now.instant()
        .add({ hours: 31 * 24 }),
    });

    expect(result.deletedRows).toBe(1);
    expect(await selectMany(stack.db, eventsTable, { aggregateId: id })).toEqual([]);
    expect(
      await selectMany(
        stack.db,
        buildEntityTable("preview-snapshot", previewSnapshotEntity),
        { id },
      ),
    ).toEqual([]);
  });
});

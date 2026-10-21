// Boot smoke test — verifies that the data-retention feature starts in
// setupTestStack and that its entity schema is valid.
//
// Deeper integration (cleanup job with DB operations, strategy dispatch,
// and cron trigger) is not covered here. This smoke test catches boot
// validation or entity-definition failures early.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../feature.ts";

let stack: TestStack;

const feature = createDataRetentionFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("data-retention :: feature-definition smoke", () => {
  test("Feature laedt clean (Boot-Validation passed)", () => {
    // setupTestStack loaded the feature in beforeAll; if boot validation
    // failed, this block would never run.
    expect(stack).toBeDefined();
    expect(feature.name).toBe("data-retention");
  });

  test("tenantRetentionOverride-Entity ist registriert", () => {
    expect(feature.entities?.["tenant-retention-override"]).toBeDefined();
  });

  test("Entity-Definition hat UNIQUE(tenantId, entityName) als 1:1-Constraint", () => {
    const entity = feature.entities?.["tenant-retention-override"];
    const indexes = entity?.indexes ?? [];
    const uniqueIndex = indexes.find((i) => i.unique === true);
    expect(uniqueIndex).toBeDefined();
    expect(uniqueIndex?.columns).toEqual(["tenantId", "entityName"]);
  });
});

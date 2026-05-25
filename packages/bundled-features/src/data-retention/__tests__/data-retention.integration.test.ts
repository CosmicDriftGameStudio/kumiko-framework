// Boot-Smoke-Test (S2.D2.5 M4) — verifiziert dass das data-retention-
// Feature im setupTestStack hochfaehrt + Entity-Schema valide ist.
//
// Tiefere Integration (Cleanup-Job mit DB-Operations + Strategy-Dispatch
// + Cron-Trigger) kommt in S2.D2b. Dieser Smoke-Test fanngt frueh ab
// ob Boot-Validation oder Entity-Definition gebrochen ist — pre-S2.D2b
// Sicherheitsnetz.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../feature";

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
    // setupTestStack hat das Feature im beforeAll geladen — wenn Boot-
    // Validation fehlschlaegt, waere dieser Block nie gelaufen.
    expect(stack).toBeDefined();
    expect(feature.name).toBe("data-retention");
  });

  test("tenantRetentionOverride-Entity ist registriert", () => {
    expect(feature.entities["tenant-retention-override"]).toBeDefined();
  });

  test("Entity-Definition hat UNIQUE(tenantId, entityName) als 1:1-Constraint", () => {
    const entity = feature.entities["tenant-retention-override"];
    const indexes = entity?.indexes ?? [];
    const uniqueIndex = indexes.find((i) => i.unique === true);
    expect(uniqueIndex).toBeDefined();
    expect(uniqueIndex?.columns).toEqual(["tenantId", "entityName"]);
  });
});

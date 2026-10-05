import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  defineFeature,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { CapCounterQueries } from "../constants.js";
import { capCounterEntity } from "../entity.js";
import { capCounterFeature } from "../feature.js";
import { createValueCapGuard } from "../value-cap-guard.js";
import { withCapEnforcement } from "../with-cap-enforcement.js";

type Caps = { readonly maxRetentionDays: number };

const { withValueCap } = createValueCapGuard<Caps>(async () => ({ maxRetentionDays: 30 }));
const { table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

const retentionSpec = {
  field: "retentionDays",
  max: (caps: Caps) => caps.maxRetentionDays,
  code: "retention_over_cap",
  i18nKey: "cap.retention-over",
} as const;

const saveRetention: WriteHandlerDef = {
  name: "save-retention",
  schema: z.object({ retentionDays: z.number().optional() }),
  access: { roles: ["TenantAdmin"] },
  handler: async () => ({ isSuccess: true as const, data: { saved: true } }),
};

const updateRetention: WriteHandlerDef = {
  name: "update-retention",
  schema: z.object({
    id: z.string(),
    version: z.number(),
    changes: z.object({ retentionDays: z.number().optional() }),
  }),
  access: { roles: ["TenantAdmin"] },
  handler: async () => ({ isSuccess: true as const, data: { saved: true } }),
};

const PERIOD = "2026-07-01T00:00:00Z";
const CAP_NAME = "retention-saves";

const countedSaveRetention: WriteHandlerDef = {
  ...saveRetention,
  name: "save-retention-counted",
};

const retentionFeature = defineFeature("retention", (r) => {
  r.writeHandler(withValueCap(saveRetention, retentionSpec));
  r.writeHandler(withValueCap(updateRetention, retentionSpec));
  r.writeHandler(
    withValueCap(
      withCapEnforcement(countedSaveRetention, () => ({
        capName: CAP_NAME,
        periodStartIso: PERIOD,
        limit: 2,
        profile: "hardSlot",
        notify: () => undefined,
      })),
      retentionSpec,
    ),
  );
});

const SAVE_QN = "retention:write:save-retention";
const UPDATE_QN = "retention:write:update-retention";
const COUNTED_QN = "retention:write:save-retention-counted";

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({ features: [capCounterFeature, retentionFeature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, capCounterEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(db, [capCounterTable, eventsTable]);
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });
}

describe("withValueCap over HTTP", () => {
  test("a value over the tier max is rejected with field, value and bound", async () => {
    const error = await stack.http.writeErr(SAVE_QN, { retentionDays: 31 }, adminFor(4101));
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe("cap.retention-over");
    expect(error.details).toMatchObject({
      reason: "retention_over_cap",
      field: "retentionDays",
      value: 31,
      max: 30,
    });
  });

  test("a value within the max and an absent value pass", async () => {
    const admin = adminFor(4102);
    await stack.http.writeOk(SAVE_QN, { retentionDays: 30 }, admin);
    await stack.http.writeOk(SAVE_QN, {}, admin);
  });

  test("the edited field of an update payload is checked under changes", async () => {
    const admin = adminFor(4103);
    const id = "11111111-1111-4111-8111-111111111111";
    await stack.http.writeOk(UPDATE_QN, { id, version: 1, changes: { retentionDays: 10 } }, admin);
    const error = await stack.http.writeErr(
      UPDATE_QN,
      { id, version: 1, changes: { retentionDays: 99 } },
      admin,
    );
    expect(error.details).toMatchObject({ reason: "retention_over_cap", value: 99 });
  });

  test("composed with withCapEnforcement both apply: the value cap rejects without using up capacity, the cap still ends the quota", async () => {
    const admin = adminFor(4104);
    const counterValue = async () => {
      const row = (await stack.http.queryOk(
        CapCounterQueries.getCounter,
        { capName: CAP_NAME, periodStartIso: PERIOD },
        createTestUser({
          id: 4104,
          tenantId: testTenantId(4104),
          roles: ["TenantAdmin", "SystemAdmin"],
        }),
      )) as Record<string, unknown> | null;
      return row?.["value"] ?? 0;
    };

    await stack.http.writeOk(COUNTED_QN, { retentionDays: 10 }, admin);
    const overMax = await stack.http.writeErr(COUNTED_QN, { retentionDays: 31 }, admin);
    expect(overMax.details).toMatchObject({ reason: "retention_over_cap" });
    expect(await counterValue()).toBe(1);

    await stack.http.writeOk(COUNTED_QN, { retentionDays: 10 }, admin);
    const capped = await stack.http.writeErr(COUNTED_QN, { retentionDays: 10 }, admin);
    expect(capped.code).toBe("cap_exceeded");
  });
});

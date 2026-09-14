// fw#2861 — createEscapeHatchAuditSink persists an escape-hatch-use event as
// audit:event:escape-hatch-used, visible through the existing audit:query:list
// handler. Real HTTP calls + setupTestStack — never createTestDispatcher.
// Modelled on audit.integration.test.ts for users/tenant setup + resetEventStore.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant";
import { AuditQueries } from "../constants";
import { createEscapeHatchAuditSink, ESCAPE_HATCH_USED_EVENT } from "../escape-hatch-audit-sink";
import { createAuditFeature } from "../feature";

const UNSAFE_RAW_REASON = "fw#2861 bundled-features integration test — declared unsafeRaw write";

const probeFeature = defineFeature("escape-hatch-audit-sink-probe", (r) => {
  r.writeHandler(
    "unsafe-raw-write",
    z.object({}),
    async (_event, ctx) => {
      ctx.db.unsafeRaw(UNSAFE_RAW_REASON);
      return { isSuccess: true as const, data: { ok: true } };
    },
    { access: { roles: ["User"] }, escapeHatch: { reason: UNSAFE_RAW_REASON } },
  );
});

let stack: TestStack;

const tenantId = testTenantId(1);
const user: SessionUser = createTestUser({ id: 9, tenantId, roles: ["User"] });
const adminOfSameTenant: SessionUser = createTestUser({ id: 10, tenantId, roles: ["Admin"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [probeFeature, createConfigFeature(), createTenantFeature(), createAuditFeature()],
    extraContext: ({ db }) => ({ _escapeHatchAuditSink: createEscapeHatchAuditSink({ db }) }),
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack);
});

type AuditRow = {
  id: string;
  type: string;
  createdBy: string;
  payload: Record<string, unknown>;
};

type AuditResponse = { rows: AuditRow[]; nextBefore: string | null };

async function pollForEscapeHatchRow(): Promise<AuditRow> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const res = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { eventType: ESCAPE_HATCH_USED_EVENT },
      adminOfSameTenant,
    );
    const row = res.rows[0];
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("escape-hatch-used audit row did not appear within 2s");
}

describe("createEscapeHatchAuditSink — persists audit:event:escape-hatch-used", () => {
  test("an unsafeRaw use is queryable via audit:query:list", async () => {
    await stack.http.writeOk("escape-hatch-audit-sink-probe:write:unsafe-raw-write", {}, user);

    const row = await pollForEscapeHatchRow();

    expect(row.type).toBe(ESCAPE_HATCH_USED_EVENT);
    expect(row.createdBy).toBe(user.id);
    expect(row.payload).toEqual({
      handler: "escape-hatch-audit-sink-probe:write:unsafe-raw-write",
      kind: "unsafe-raw",
      reason: UNSAFE_RAW_REASON,
      actor: user.id,
    });
  });
});

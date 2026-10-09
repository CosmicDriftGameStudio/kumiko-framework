// fw#2861 — createEscapeHatchAuditSink persists an escape-hatch-use event as
// audit:event:escape-hatch-used, visible through the existing audit:query:list
// handler. Real HTTP calls + setupTestStack — never createTestDispatcher.
// Modelled on audit.integration.test.ts for users/tenant setup + resetEventStore.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { createConfigFeature } from "../../config/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { createUserFeature } from "../../user/index.js";
import { AuditQueries } from "../constants.js";
import { createEscapeHatchAuditSink, ESCAPE_HATCH_USED_EVENT } from "../escape-hatch-audit-sink.js";
import { createAuditFeature } from "../feature.js";

const UNSAFE_RAW_REASON = "fw#2861 bundled-features integration test — declared unsafeRaw write";

const probeFeature = defineFeature("escape-hatch-audit-sink-probe", (r) => {
  r.writeHandler(
    "unsafe-raw-write",
    z.object({}),
    async (_event, ctx) => {
      ctx.db.unsafeRaw();
      return { isSuccess: true as const, data: { ok: true } };
    },
    { access: { roles: ["User"] }, escapeHatch: { reason: UNSAFE_RAW_REASON } },
  );
});

const failingProbeFeature = defineFeature("escape-hatch-audit-failing-probe", (r) => {
  r.writeHandler(
    "unsafe-raw-then-fail",
    z.object({}),
    async (_event, ctx) => {
      ctx.db.unsafeRaw();
      return writeFailure(new UnprocessableError("handler_rejected"));
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
    features: [
      probeFeature,
      failingProbeFeature,
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createAuditFeature(),
    ],
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
  let row: AuditRow | undefined;
  await waitFor(
    async () => {
      const res = await stack.http.queryOk<AuditResponse>(
        AuditQueries.list,
        { eventType: ESCAPE_HATCH_USED_EVENT },
        adminOfSameTenant,
      );
      row = res.rows[0];
      return row !== undefined;
    },
    { delays: Array(40).fill(50) },
  );
  if (row === undefined) throw new Error("escape-hatch-used audit row did not appear within 2s");
  return row;
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

describe("the escape-hatch audit is durable (#3607)", () => {
  test("the audit entry survives a handler rollback and is persisted when the dispatch returns", async () => {
    const error = await stack.http.writeErr(
      "escape-hatch-audit-failing-probe:write:unsafe-raw-then-fail",
      {},
      user,
    );
    expect(error.code).toBe("unprocessable");

    // No polling: the dispatch has already awaited the audit write.
    const res = await stack.http.queryOk<AuditResponse>(
      AuditQueries.list,
      { eventType: ESCAPE_HATCH_USED_EVENT },
      adminOfSameTenant,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.payload["handler"]).toBe(
      "escape-hatch-audit-failing-probe:write:unsafe-raw-then-fail",
    );
  });
});

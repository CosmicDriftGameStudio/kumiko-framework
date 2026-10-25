// createEscapeHatchAuditSink persists an escape-hatch-use event as
// audit:event:escape-hatch-used, visible through the existing audit:query:list
// handler. Real HTTP calls + setupTestStack — never createTestDispatcher.
// Modelled on audit.integration.test.ts for users/tenant setup + resetEventStore.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { createUserFeature } from "../../user/index.ts";
import { createEscapeHatchAuditSink, ESCAPE_HATCH_USED_EVENT } from "../escape-hatch-audit-sink.ts";
import { createAuditFeature } from "../feature.ts";
import { AuditQueries } from "../web/constants.ts";

const UNSAFE_RAW_REASON = "fw#2861 bundled-features integration test — declared unsafeRaw write";

const probeFeature = defineFeature("escape-hatch-audit-sink-probe", (r) => {
  r.writeHandler({
    name: "unsafe-raw-write",
    schema: z.object({}),
    handler: async (_event, ctx) => {
      ctx.db.unsafeRaw();
      return { isSuccess: true as const, data: { ok: true } };
    },
    access: { roles: ["User"] },
    escapeHatch: { reason: UNSAFE_RAW_REASON },
  });
});

const failingProbeFeature = defineFeature("escape-hatch-audit-failing-probe", (r) => {
  r.writeHandler({
    name: "unsafe-raw-then-fail",
    schema: z.object({}),
    handler: async (_event, ctx) => {
      ctx.db.unsafeRaw();
      return writeFailure(new UnprocessableError("handler_rejected"));
    },
    access: { roles: ["User"] },
    escapeHatch: { reason: UNSAFE_RAW_REASON },
  });
});

const ACKNOWLEDGE_REASON = "bundled-features integration test — declared cross-tenant read";

const crossTenantProbeFeature = defineFeature("escape-hatch-audit-cross-tenant-probe", (r) => {
  r.systemScope();
  r.queryHandler({
    name: "cross-tenant-read",
    schema: z.object({}),
    handler: async (_query, ctx) => {
      if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
      const db = ctx.systemDb.acknowledgeCrossTenant(ACKNOWLEDGE_REASON);
      return { tenantId: db.tenantId };
    },
    access: { roles: ["SystemAdmin"] },
  });
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
      crossTenantProbeFeature,
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

describe("the escape-hatch audit is durable", () => {
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

const PROBE_READ = "escape-hatch-audit-cross-tenant-probe:query:cross-tenant-read";
// The dispatcher's dedupe window outlives resetEventStore, so each test reads as its own actors.
const systemAdminOf = (id: number): SessionUser =>
  createTestUser({ id, tenantId: TestUsers.systemAdmin.tenantId, roles: ["SystemAdmin"] });
const pageReader = systemAdminOf(20);
const firstReader = systemAdminOf(21);
const secondReader = systemAdminOf(22);

async function escapeHatchHandlers(reader: SessionUser): Promise<string[]> {
  const res = await stack.http.queryOk<AuditResponse>(
    AuditQueries.listAllTenants,
    { eventType: ESCAPE_HATCH_USED_EVENT },
    reader,
  );
  return res.rows.map((row) => String(row.payload["handler"]));
}

describe("cross-tenant reads are recorded once per actor and window", () => {
  test("repeated reads by the same SystemAdmin leave one event", async () => {
    await stack.http.queryOk(PROBE_READ, {}, pageReader);
    await stack.http.queryOk(PROBE_READ, {}, pageReader);
    await escapeHatchHandlers(pageReader);

    // The audit page's own all-tenants read is a cross-tenant read too: one trace, not one per load.
    expect((await escapeHatchHandlers(pageReader)).sort()).toEqual(
      [AuditQueries.listAllTenants, PROBE_READ].sort(),
    );
  });

  test("a different actor gets an event of its own", async () => {
    await stack.http.queryOk(PROBE_READ, {}, firstReader);
    await stack.http.queryOk(PROBE_READ, {}, secondReader);

    const res = await stack.http.queryOk<AuditResponse>(
      AuditQueries.listAllTenants,
      { eventType: ESCAPE_HATCH_USED_EVENT },
      TestUsers.systemAdmin,
    );
    const probeActors = res.rows
      .filter((row) => row.payload["handler"] === PROBE_READ)
      .map((row) => row.payload["actor"]);
    expect(probeActors.sort()).toEqual([firstReader.id, secondReader.id].sort());
  });
});

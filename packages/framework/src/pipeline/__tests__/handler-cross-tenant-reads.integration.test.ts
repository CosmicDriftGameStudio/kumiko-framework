// ctx.crossTenantReads on handlers: only present with a crossTenantReads/unsafeRaw grant,
// read-only, tenant-unfiltered (incl. the events table), audited per report window and metered per call, never inside an
// agent tool call. Real HTTP + setupTestStack; the agent cases use the scope dispatchToolCall sets.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { runAsAgentToolCallEntry } from "../../api/request-context.ts";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import type { EscapeHatchUseEvent, HandlerContext } from "../../engine/types/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import {
  DEFAULT_SENSITIVE_CONFIG,
  type MetricEvent,
  type ObservabilityProvider,
  RecordingMeter,
  RecordingTracer,
} from "../../observability/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";

const noteEntity = createEntity({
  table: "handler_xtr_notes",
  fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const noteTable = buildEntityTable("note", noteEntity);
const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

const GRANT_REASON = "cross-tenant overview probe — reads notes of every tenant";
const FEATURE = "handler-xtr";

type ReadsOutcome = {
  readonly hasReads: boolean;
  readonly titles?: readonly string[];
  readonly foreignTitle?: string | undefined;
  readonly count?: number;
  readonly foreignEventTenants?: readonly string[];
  readonly unsafeRawCode?: string;
};

async function readAcrossTenants(
  ctx: HandlerContext,
  foreignTenantId: string,
): Promise<ReadsOutcome> {
  const reads = ctx.crossTenantReads;
  if (!reads) return { hasReads: false };
  const all = await reads.selectMany<{ title: string }>(noteTable);
  const foreign = await reads.fetchOne<{ title: string }>(noteTable, {
    tenantId: foreignTenantId,
  });
  const count = await reads.count(noteTable);
  const events = await reads.selectMany<{ tenantId: string }>(eventsTable, {
    tenantId: foreignTenantId,
  });
  let unsafeRawCode: string | undefined;
  try {
    ctx.db.unsafeRaw();
  } catch (err) {
    unsafeRawCode = err instanceof Error && "code" in err ? String(err.code) : "unknown";
  }
  return {
    hasReads: true,
    titles: all.map((n) => n.title).sort(),
    foreignTitle: foreign?.title,
    count,
    foreignEventTenants: events.map((e) => e.tenantId),
    ...(unsafeRawCode !== undefined && { unsafeRawCode }),
  };
}

const probeFeature = defineFeature(FEATURE, (r) => {
  r.entity({ name: "note", ...noteEntity });

  r.writeHandler({
    name: "add-note",
    schema: z.object({ title: z.string() }),
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const created = await noteExecutor.create({ title: event.payload.title }, ctx.user, ctx.db);
      return created.isSuccess ? { isSuccess: true as const, data: {} } : created;
    },
  });

  r.queryHandler({
    name: "plain",
    schema: z.object({ foreignTenantId: z.string() }),
    access: { roles: ["Admin"] },
    handler: async (_query, ctx): Promise<ReadsOutcome> => {
      const own = await ctx.db.selectMany<{ title: string }>(noteTable, {});
      return { hasReads: ctx.crossTenantReads !== undefined, titles: own.map((n) => n.title) };
    },
  });

  r.queryHandler({
    name: "granted",
    schema: z.object({ foreignTenantId: z.string() }),
    access: { roles: ["Admin"] },
    escapeHatch: { reason: GRANT_REASON, grants: ["crossTenantReads"] },
    handler: (query, ctx) => readAcrossTenants(ctx, query.payload.foreignTenantId),
  });

  r.queryHandler({
    name: "implied",
    schema: z.object({ foreignTenantId: z.string() }),
    access: { roles: ["Admin"] },
    escapeHatch: { reason: GRANT_REASON, grants: ["unsafeRaw"] },
    handler: (query, ctx) => readAcrossTenants(ctx, query.payload.foreignTenantId),
  });

  r.queryHandler({
    name: "delegating",
    schema: z.object({ foreignTenantId: z.string() }),
    access: { roles: ["Admin"] },
    handler: (query, ctx) => ctx.query(`${FEATURE}:query:granted`, query.payload),
  });
});

const ownTenant = testTenantId(9601);
const foreignTenant = testTenantId(9602);
const ownAdmin = createTestUser({ id: 1, tenantId: ownTenant, roles: ["Admin"] });
const foreignAdmin = createTestUser({ id: 2, tenantId: foreignTenant, roles: ["Admin"] });

const auditEvents: EscapeHatchUseEvent[] = [];
const metricEvents: MetricEvent[] = [];
let stack: TestStack;
const recordingProvider: ObservabilityProvider = {
  name: "recording",
  meter: new RecordingMeter((e) => metricEvents.push(e)),
  tracer: new RecordingTracer({ sensitiveConfig: DEFAULT_SENSITIVE_CONFIG, onSpanEnd: () => {} }),
  shutdown: async () => {},
};

beforeAll(async () => {
  stack = await setupTestStack({
    features: [probeFeature],
    observability: recordingProvider,
    extraContext: {
      _escapeHatchAuditSink: async (event: EscapeHatchUseEvent) => {
        auditEvents.push(event);
      },
    },
  });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [noteTable, eventsTable]);
  auditEvents.length = 0;
  metricEvents.length = 0;
  await stack.http.writeOk(`${FEATURE}:write:add-note`, { title: "own-note" }, ownAdmin);
  await stack.http.writeOk(`${FEATURE}:write:add-note`, { title: "foreign-note" }, foreignAdmin);
});

describe("ctx.crossTenantReads on handlers", () => {
  test("a handler without escapeHatch gets no crossTenantReads and only sees its own rows", async () => {
    const result = await stack.http.queryOk<ReadsOutcome>(
      `${FEATURE}:query:plain`,
      { foreignTenantId: foreignTenant },
      ownAdmin,
    );

    expect(result).toEqual({ hasReads: false, titles: ["own-note"] });
    expect(auditEvents).toEqual([]);
  });

  test("grants: [crossTenantReads] reads every tenant but still denies unsafeRaw, and audits once while metering each read", async () => {
    const result = await stack.http.queryOk<ReadsOutcome>(
      `${FEATURE}:query:granted`,
      { foreignTenantId: foreignTenant },
      ownAdmin,
    );

    expect(result.hasReads).toBe(true);
    expect(result.titles).toEqual(["foreign-note", "own-note"]);
    expect(result.foreignTitle).toBe("foreign-note");
    expect(result.count).toBe(2);
    expect(result.unsafeRawCode).toBe("access_denied");
    // Targetless reads dedup inside the report window: one audit event, while the meter counts every call.
    const reads = auditEvents.filter((e) => e.kind === "cross-tenant-read");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      handler: `${FEATURE}:query:granted`,
      reason: GRANT_REASON,
      tenantId: ownTenant,
      actor: ownAdmin.id,
    });
    const meteredReads = metricEvents.filter(
      (e) =>
        e.name === "kumiko_escape_hatch_uses_total" && e.labels?.["kind"] === "cross-tenant-read",
    );
    expect(meteredReads).toHaveLength(4);
  });

  test("the events table can be read for a foreign tenant", async () => {
    const result = await stack.http.queryOk<ReadsOutcome>(
      `${FEATURE}:query:granted`,
      { foreignTenantId: foreignTenant },
      ownAdmin,
    );

    expect(result.foreignEventTenants?.length).toBeGreaterThan(0);
    expect(new Set(result.foreignEventTenants)).toEqual(new Set([foreignTenant]));
  });

  for (const handler of ["granted", "implied", "delegating"]) {
    test(`an agent tool call on ${handler} gets no crossTenantReads`, async () => {
      const result = await runAsAgentToolCallEntry(() =>
        stack.dispatcher.query(
          `${FEATURE}:query:${handler}`,
          { foreignTenantId: foreignTenant },
          ownAdmin,
        ),
      );

      expect(result).toEqual({ hasReads: false });
      expect(auditEvents.filter((e) => e.kind === "cross-tenant-read")).toEqual([]);
    });
  }

  test("the same dispatch outside an agent tool call gets crossTenantReads", async () => {
    const result = await stack.dispatcher.query(
      `${FEATURE}:query:implied`,
      { foreignTenantId: foreignTenant },
      ownAdmin,
    );

    expect(result).toMatchObject({ hasReads: true, count: 2 });
  });
});

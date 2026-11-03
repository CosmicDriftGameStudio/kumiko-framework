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
import type { EscapeHatchUseEvent } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { runAsAgentToolCallEntry } from "../../api/request-context.ts";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineFeature,
} from "../../engine/index.ts";
import type { HandlerContext } from "../../engine/types/index.ts";

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

const catalogEntity = createEntity({
  table: "handler_xtr_catalog",
  tenancy: "global",
  systemStream: true,
  fields: { label: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const catalogTable = buildEntityTable("catalog", catalogEntity);

const ledgerEntity = createEntity({
  table: "handler_xtr_ledger",
  fields: { label: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const ledgerTable = buildEntityTable("ledger", ledgerEntity);

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

const systemProbeFeature = defineFeature("handler-xtr-system", (r) => {
  r.systemScope();
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    handler: async () => ({ ran: true }),
  });
});

const GLOBAL_FEATURE = "handler-xtr-global";
const globalCatalogFeature = defineFeature(GLOBAL_FEATURE, (r) => {
  r.systemScope();
  r.entity({ name: "catalog", ...catalogEntity });
  r.entity({ name: "ledger", ...ledgerEntity });
  r.writeHandler(
    defineEntityCreateHandler("catalog", catalogEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(
    defineEntityListHandler("catalog", catalogEntity, { access: { roles: ["Admin"] } }),
  );
  r.writeHandler(
    defineEntityCreateHandler("ledger", ledgerEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(defineEntityListHandler("ledger", ledgerEntity, { access: { roles: ["Admin"] } }));
});

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
    name: "raw-sql",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    escapeHatch: { reason: GRANT_REASON, grants: ["unsafeRaw"] },
    handler: async (_query, ctx) => {
      ctx.db.unsafeRaw();
      return { reachedRaw: true };
    },
  });

  r.queryHandler({
    name: "delegating",
    schema: z.object({ foreignTenantId: z.string() }),
    access: { roles: ["Admin"] },
    handler: (query, ctx) => ctx.dispatch.query(`${FEATURE}:query:granted`, query.payload),
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
    features: [probeFeature, systemProbeFeature, globalCatalogFeature],
    observability: recordingProvider,
    extraContext: {
      _escapeHatchAuditSink: async (event: EscapeHatchUseEvent) => {
        auditEvents.push(event);
      },
    },
  });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  await unsafeCreateEntityTable(stack.db, catalogEntity, "catalog");
  await unsafeCreateEntityTable(stack.db, ledgerEntity, "ledger");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [noteTable, catalogTable, ledgerTable, eventsTable]);
  await stack.http.writeOk(`${FEATURE}:write:add-note`, { title: "own-note" }, ownAdmin);
  await stack.http.writeOk(`${FEATURE}:write:add-note`, { title: "foreign-note" }, foreignAdmin);
  await stack.http.writeOk(`${GLOBAL_FEATURE}:write:catalog:create`, { label: "shared" }, ownAdmin);
  await stack.http.writeOk(
    `${GLOBAL_FEATURE}:write:ledger:create`,
    { label: "own-ledger" },
    ownAdmin,
  );
  auditEvents.length = 0;
  metricEvents.length = 0;
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

  test("an agent tool call on a handler with an unsafeRaw grant is denied unsafeRaw", async () => {
    const outsideAgent = await stack.dispatcher.query(`${FEATURE}:query:raw-sql`, {}, ownAdmin);
    expect(outsideAgent).toEqual({ reachedRaw: true });

    await expect(
      runAsAgentToolCallEntry(() =>
        stack.dispatcher.query(`${FEATURE}:query:raw-sql`, {}, ownAdmin),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  test("an agent tool call cannot run a system-scope handler, other callers can", async () => {
    const outsideAgent = await stack.dispatcher.query(
      "handler-xtr-system:query:ping",
      {},
      ownAdmin,
    );
    expect(outsideAgent).toEqual({ ran: true });

    await expect(
      runAsAgentToolCallEntry(() =>
        stack.dispatcher.query("handler-xtr-system:query:ping", {}, ownAdmin),
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  describe("global entity reads inside an agent tool call", () => {
    const labelsOf = (result: unknown): string[] =>
      (result as { rows: { label: string }[] }).rows.map((r) => r.label).sort();

    test("a system-scope feature's list on a tenancy-global entity returns the shared rows", async () => {
      const result = await runAsAgentToolCallEntry(() =>
        stack.dispatcher.query(`${GLOBAL_FEATURE}:query:catalog:list`, {}, foreignAdmin),
      );
      expect(labelsOf(result)).toEqual(["shared"]);
    });

    test("a write on the global entity is still denied in an agent tool call", async () => {
      const result = await runAsAgentToolCallEntry(() =>
        stack.dispatcher.write(
          `${GLOBAL_FEATURE}:write:catalog:create`,
          { label: "agent-made" },
          ownAdmin,
        ),
      );
      expect(result).toMatchObject({
        isSuccess: false,
        error: { code: "access_denied", details: { reason: "agent.tool_not_allowed" } },
      });
    });

    test("a list on a system-scope entity that is not global is still denied", async () => {
      await expect(
        runAsAgentToolCallEntry(() =>
          stack.dispatcher.query(`${GLOBAL_FEATURE}:query:ledger:list`, {}, ownAdmin),
        ),
      ).rejects.toMatchObject({ code: "access_denied" });
    });
  });
});

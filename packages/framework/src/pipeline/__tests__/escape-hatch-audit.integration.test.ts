// fw#2861 — every escape-hatch use reports through AppContext._escapeHatchAuditSink
// (or warn-logs when no sink is wired). Real HTTP calls + setupTestStack — never
// createTestDispatcher. Modelled on unsafe-raw-escape-hatch.integration.test.ts and
// system-identity-switch.integration.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineUnmanagedTable } from "../../db/entity-table-meta";
import { executeRawQuery } from "../../db/queries/raw-sql";
import { createSystemUser, defineFeature } from "../../engine";
import type { EscapeHatchUseEvent } from "../../engine/types";
import type { Logger } from "../../logging/types";
import { createTestUser, setupTestStack, type TestStack } from "../../stack";
import { ESCAPE_HATCH_USED_SIGNAL } from "../escape-hatch-report";

const globalStoreTable = defineUnmanagedTable({
  tableName: "store_fw2861_escape_hatch_audit_items",
  tenancy: "global",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "note", pgType: "text", notNull: true },
  ],
});

const UNSAFE_RAW_REASON = "fw#2861 integration test — declared unsafeRaw write";
const GLOBAL_WRITE_REASON = "fw#2861 integration test — declared cross-tenant write";
const IDENTITY_SWITCH_REASON = "fw#2861 integration test — needs SYSTEM to look itself up";
const ACKNOWLEDGE_REASON = "fw#2861 integration test — system-wide scan";

const probeFeature = defineFeature("escape-hatch-audit-probe", (r) => {
  r.storeTable(globalStoreTable, {
    reason: "fw#2861 integration test — cross-tenant store table for db.global()",
  });

  r.queryHandler(
    "whoami",
    z.object({}),
    async (query) => ({ id: query.user.id, tenantId: query.user.tenantId }),
    { access: { roles: ["system", "User"] } },
  );

  r.writeHandler(
    "unsafe-raw-write",
    z.object({}),
    async (_event, ctx) => {
      const runner = ctx.db.unsafeRaw(UNSAFE_RAW_REASON);
      const rows = await executeRawQuery<{ one: number }>(runner, "SELECT 1 AS one");
      return { isSuccess: true as const, data: { one: rows[0]?.one } };
    },
    { access: { roles: ["User"] }, escapeHatch: { reason: UNSAFE_RAW_REASON } },
  );

  r.writeHandler(
    "global-write",
    z.object({}),
    async (_event, ctx) => {
      const row = await ctx.db.global(globalStoreTable).insertOne<{ id: string }>({
        note: "hi",
      });
      return { isSuccess: true as const, data: row };
    },
    { access: { roles: ["User"] }, escapeHatch: { reason: GLOBAL_WRITE_REASON } },
  );

  r.writeHandler(
    "identity-switch-write",
    z.object({}),
    async (event, ctx) =>
      ctx
        .queryAs(createSystemUser(event.user.tenantId), "escape-hatch-audit-probe:query:whoami", {})
        .then((data) => ({ isSuccess: true as const, data })),
    { access: { roles: ["User"] }, escapeHatch: { reason: IDENTITY_SWITCH_REASON } },
  );

  r.writeHandler(
    "identity-switch-self-write",
    z.object({}),
    async (event, ctx) =>
      ctx
        .queryAs(event.user, "escape-hatch-audit-probe:query:whoami", {})
        .then((data) => ({ isSuccess: true as const, data })),
    { access: { roles: ["User"] }, escapeHatch: { reason: IDENTITY_SWITCH_REASON } },
  );
});

const systemScopeProbeFeature = defineFeature("escape-hatch-audit-probe-system", (r) => {
  r.systemScope();

  r.queryHandler(
    "acknowledge-cross-tenant-query",
    z.object({}),
    async (_query, ctx) => {
      if (!ctx.systemDb) throw new Error("expected ctx.systemDb on a systemScope() handler");
      const db = ctx.systemDb.acknowledgeCrossTenant(ACKNOWLEDGE_REASON);
      return { tenantId: db.tenantId };
    },
    { access: { roles: ["User"] } },
  );
});

const user = createTestUser({
  id: 93,
  tenantId: "11111111-0000-4000-8000-000000000093",
  roles: ["User"],
});

function recordingSink(events: EscapeHatchUseEvent[]) {
  return async (event: EscapeHatchUseEvent) => {
    events.push(event);
  };
}

describe("escape-hatch uses report through AppContext._escapeHatchAuditSink", () => {
  let stack: TestStack;
  const events: EscapeHatchUseEvent[] = [];

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [probeFeature, systemScopeProbeFeature],
      extraContext: { _escapeHatchAuditSink: recordingSink(events) },
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("unsafeRaw reports exactly one unsafe-raw event with handler/kind/reason/tenantId/actor, deduped on a repeat call within the window", async () => {
    events.length = 0;
    await stack.http.writeOk("escape-hatch-audit-probe:write:unsafe-raw-write", {}, user);
    // Identical (handler, kind, reason, tenantId, actor) — the 60s dedup window
    // must suppress this second report.
    await stack.http.writeOk("escape-hatch-audit-probe:write:unsafe-raw-write", {}, user);

    const matches = events.filter((e) => e.kind === "unsafe-raw");
    expect(matches).toEqual([
      {
        handler: "escape-hatch-audit-probe:write:unsafe-raw-write",
        kind: "unsafe-raw",
        reason: UNSAFE_RAW_REASON,
        tenantId: user.tenantId,
        actor: user.id,
      },
    ]);
  });

  test("db.global() write reports exactly one global-write event with the escapeHatch's reason", async () => {
    events.length = 0;
    await stack.http.writeOk("escape-hatch-audit-probe:write:global-write", {}, user);

    const matches = events.filter((e) => e.kind === "global-write");
    expect(matches).toEqual([
      {
        handler: "escape-hatch-audit-probe:write:global-write",
        kind: "global-write",
        reason: GLOBAL_WRITE_REASON,
        tenantId: user.tenantId,
        actor: user.id,
      },
    ]);
  });

  test("ctx.systemDb.acknowledgeCrossTenant reports exactly one acknowledge-cross-tenant event", async () => {
    events.length = 0;
    await stack.http.queryOk(
      "escape-hatch-audit-probe-system:query:acknowledge-cross-tenant-query",
      {},
      user,
    );

    const matches = events.filter((e) => e.kind === "acknowledge-cross-tenant");
    expect(matches).toEqual([
      {
        handler: "escape-hatch-audit-probe-system:query:acknowledge-cross-tenant-query",
        kind: "acknowledge-cross-tenant",
        reason: ACKNOWLEDGE_REASON,
        tenantId: user.tenantId,
        actor: user.id,
      },
    ]);
  });

  test("a granted SYSTEM identity switch reports exactly one identity-switch event with the target", async () => {
    events.length = 0;
    await stack.http.writeOk("escape-hatch-audit-probe:write:identity-switch-write", {}, user);

    const matches = events.filter((e) => e.kind === "identity-switch");
    expect(matches).toEqual([
      {
        handler: "escape-hatch-audit-probe:write:identity-switch-write",
        kind: "identity-switch",
        reason: IDENTITY_SWITCH_REASON,
        tenantId: user.tenantId,
        actor: user.id,
        target: { id: createSystemUser(user.tenantId).id, tenantId: user.tenantId },
      },
    ]);
  });

  test("self-delegation with a grant reports no identity-switch event", async () => {
    events.length = 0;
    await stack.http.writeOk("escape-hatch-audit-probe:write:identity-switch-self-write", {}, user);

    expect(events.filter((e) => e.kind === "identity-switch")).toEqual([]);
  });
});

describe("escape-hatch uses without a sink fall back to a structured warn log", () => {
  let stack: TestStack;
  const warnCalls: Array<{ msg: string; data?: Record<string, unknown> }> = [];

  beforeAll(async () => {
    const log: Logger = {
      info() {},
      debug() {},
      warn(msg, data) {
        warnCalls.push({ msg, data });
      },
      error() {},
      child() {
        return log;
      },
    };
    stack = await setupTestStack({
      features: [probeFeature, systemScopeProbeFeature],
      extraContext: { log },
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("unsafeRaw without a sink warn-logs security:escape-hatch-used", async () => {
    warnCalls.length = 0;
    await stack.http.writeOk("escape-hatch-audit-probe:write:unsafe-raw-write", {}, user);

    const matches = warnCalls.filter((c) => c.msg === ESCAPE_HATCH_USED_SIGNAL);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.data).toEqual({
      handler: "escape-hatch-audit-probe:write:unsafe-raw-write",
      kind: "unsafe-raw",
      reason: UNSAFE_RAW_REASON,
      tenantId: user.tenantId,
      actor: user.id,
    });
  });
});

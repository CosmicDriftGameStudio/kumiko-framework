// Proves the agent-tools catalog + dispatch work over the REAL HTTP surface (/api/query,
// /api/write), not an in-process shortcut — a hand-rolled recording dispatcher would happily
// hide an access-check regression (it "dispatches" without ever consulting the real pipeline).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import {
  createEntity,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { buildAgentManifest } from "../agent-manifest";
import { buildToolCatalog, toolNameForQn } from "../tool-catalog";
import type { ToolDispatcher } from "../tool-dispatch";
import { dispatchToolCall } from "../tool-dispatch";

const FEATURE_NAME = "agent-tools-int-test";

const widgetEntity = createEntity({
  table: "agent_tools_int_test_widgets",
  fields: {
    name: createTextField({ required: true, searchable: true, filterable: true }),
    status: createSelectField({ options: ["pending", "approved"] as const, filterable: true }),
  },
});

const widgetFeature = defineFeature(FEATURE_NAME, (r) => {
  r.crud("widget", widgetEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin", "Reader"] } },
  });

  r.writeHandler(
    "widget:approve",
    z.object({ id: z.string(), version: z.number() }),
    async (event, ctx) =>
      ctx.write(`${FEATURE_NAME}:write:widget:update`, {
        id: event.payload.id,
        version: event.payload.version,
        changes: { status: "approved" },
      }),
    { access: { roles: ["Admin"] }, description: "Approve a widget." },
  );
});

const WIDGET_CREATE_QN = `${FEATURE_NAME}:write:widget:create`;
const WIDGET_DETAIL_QN = `${FEATURE_NAME}:query:widget:detail`;
const APPROVE_QN = `${FEATURE_NAME}:write:widget:approve`;
const APPROVE_TOOL_NAME = toolNameForQn(APPROVE_QN);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [widgetFeature] });
  await unsafeCreateEntityTable(stack.db, widgetEntity);
}, 20000);

afterAll(async () => {
  await stack.cleanup();
});

const admin = createTestUser({ roles: ["Admin"] });
const reader = createTestUser({ roles: ["Reader"], id: admin.id, tenantId: admin.tenantId });

function catalogFor(roles: readonly string[]) {
  const manifest = buildAgentManifest(stack.registry, { locale: "en", roles });
  return buildToolCatalog(stack.registry, manifest, { mode: "edit", roles, locale: "en" });
}

/** ToolDispatcher backed by real HTTP requests through the app — response-shape empirically
 *  confirmed against `packages/framework/src/api/routes.ts`: query success is `{ data }`,
 *  query failure is `{ error }` with a non-2xx status (must throw here, or an access-denied
 *  body comes back as `ok: true` and every rejection assertion below would pass vacuously);
 *  write success/failure both already match the `WriteResult` wire shape 1:1. */
function buildHttpDispatcher(): ToolDispatcher {
  return {
    async query(type, payload, user) {
      const res = await stack.http.query(type, payload, user);
      const body = (await res.json()) as { data?: unknown; error?: unknown };
      if (!res.ok) {
        throw new Error(`query "${type}" failed: ${JSON.stringify(body.error ?? body)}`);
      }
      return body.data;
    },
    async write(type, payload, user, requestId) {
      const res = await stack.http.write(type, payload, user, requestId);
      return (await res.json()) as WriteResult;
    },
  };
}

describe("agent tools over real HTTP", () => {
  test("the catalog contains the described write tool", () => {
    const catalog = catalogFor(["Admin"]);
    expect(catalog.tools.map((t) => t.name)).toContain(APPROVE_TOOL_NAME);
  });

  test("catalog role-filtering: a Reader-scoped catalog does not expose the Admin-only approve tool", () => {
    const catalog = catalogFor(["Reader"]);
    expect(catalog.tools.map((t) => t.name)).not.toContain(APPROVE_TOOL_NAME);
  });

  test("dispatch-level denial: a reader calling the (Admin-only) approve tool is rejected by the write pipeline itself, not by an absent tool", async () => {
    // Create's wire result nests the projection under `data` (`{ id, data: { version, ... } }`
    // — same shape asserted in domain-events-projections.integration.test.ts), not a flat
    // `{ id, version }`.
    const created = await stack.http.writeOk<{ id: string; data: { version: number } }>(
      WIDGET_CREATE_QN,
      { name: "Widget A", status: "pending" },
      admin,
    );

    // Built for Admin so the approve tool descriptor exists — the reader is denied by
    // dispatcher.write's own access check, not by a catalog lookup miss. The reader still
    // has read access (["Admin", "Reader"]), so the injectsVersion pre-read through the
    // detail handler succeeds and the write call is what actually gets rejected.
    const catalog = catalogFor(["Admin"]);
    const result = await dispatchToolCall({
      dispatcher: buildHttpDispatcher(),
      user: reader,
      toolName: APPROVE_TOOL_NAME,
      input: { id: created.id },
      dispatchTable: catalog.dispatchTable,
      runId: "run-denied",
      toolCallId: "call-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).not.toContain("Unknown tool");
    expect(result.error).toContain("access denied");
    expect(result.error).toContain("widget:approve");

    const stillPending = await stack.http.queryOk<{ status: string; version: number }>(
      WIDGET_DETAIL_QN,
      { id: created.id },
      admin,
    );
    expect(stillPending.status).toBe("pending");
    expect(stillPending.version).toBe(created.data.version);
  });

  test("dispatching the write tool with the role succeeds and increments the version", async () => {
    const created = await stack.http.writeOk<{ id: string; data: { version: number } }>(
      WIDGET_CREATE_QN,
      { name: "Widget B", status: "pending" },
      admin,
    );

    const catalog = catalogFor(["Admin"]);
    const result = await dispatchToolCall({
      dispatcher: buildHttpDispatcher(),
      user: admin,
      toolName: APPROVE_TOOL_NAME,
      input: { id: created.id },
      dispatchTable: catalog.dispatchTable,
      runId: "run-allowed",
      toolCallId: "call-1",
    });

    expect(result.ok).toBe(true);

    const updated = await stack.http.queryOk<{ status: string; version: number }>(
      WIDGET_DETAIL_QN,
      { id: created.id },
      admin,
    );
    expect(updated.status).toBe("approved");
    expect(updated.version).toBeGreaterThan(created.data.version);
  });

  test("list_widget returns a numeric total", async () => {
    await stack.http.writeOk(WIDGET_CREATE_QN, { name: "Widget C", status: "pending" }, admin);

    const catalog = catalogFor(["Admin"]);
    const result = await dispatchToolCall({
      dispatcher: buildHttpDispatcher(),
      user: admin,
      toolName: "list_widget",
      input: {},
      dispatchTable: catalog.dispatchTable,
      runId: "run-list",
      toolCallId: "call-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const data = result.data as { total?: unknown };
    expect(typeof data.total).toBe("number");
  });
});

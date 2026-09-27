// Proves the property the unit tests can't: dispatchToolCall runs through the
// REAL <entity>:list handler + permission pipeline, not a fake. Two things a
// hand-rolled recording dispatcher would happily hide:
//   - tenant isolation: tenant A's find_by_iban call must never surface
//     tenant B's row, even when both tenants have the exact same IBAN value.
//   - cap enforcement: a caller without the list handler's required role
//     gets denied, not an empty-but-"ok" result.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { buildAgentManifest } from "../agent-manifest";
import { buildToolCatalog, toolNameForQn } from "../tool-catalog";
import { dispatchToolCall } from "../tool-dispatch";

const vendorEntity = createEntity({
  table: "agent_tools_test_vendors",
  fields: {
    name: createTextField({
      required: true,
      searchable: true,
      filterable: true,
      personal: false,
      reason: "is_business_data",
    }),
    iban: createTextField({
      required: true,
      filterable: true,
      personal: false,
      reason: "is_business_data",
    }),
  },
});

const vendorFeature = defineFeature("agent-tools-test-vendor", (r) => {
  r.crud("vendor", vendorEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Reader"] } },
  });
});

const VENDOR_CREATE_QN = "agent-tools-test-vendor:write:vendor:create";

// No softDelete — forget-gizmo-high performs a hard, irreversible purge and
// therefore must resolve agent.risk "high" to pass the executor gate.
const gizmoEntity = createEntity({
  table: "agent_tools_test_gizmos",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const { executor: gizmoExecutor } = createEntityExecutor("gizmo", gizmoEntity);

const GIZMO_CREATE_QN = "agent-tools-test-gizmo:write:gizmo:create";
const GIZMO_FORGET_HIGH_QN = "agent-tools-test-gizmo:write:forget-gizmo-high";
const GIZMO_DELEGATE_FORGET_MID_QN = "agent-tools-test-gizmo:write:delegate-forget-gizmo-mid";

const gizmoFeature = defineFeature("agent-tools-test-gizmo", (r) => {
  r.entity("gizmo", gizmoEntity);

  r.writeHandler(
    "gizmo:create",
    z.object({ label: z.string() }),
    async (event, ctx) => gizmoExecutor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "forget-gizmo-high",
    z.object({ id: z.uuid() }),
    async (event, ctx) => gizmoExecutor.forget({ id: event.payload.id }, event.user, ctx.db),
    {
      access: { roles: ["Admin"] },
      description: "Permanently forget a gizmo (GDPR erasure).",
      agent: { risk: "high" },
    },
  );

  r.writeHandler(
    "delegate-forget-gizmo-mid",
    z.object({ id: z.uuid() }),
    async (event, ctx) =>
      ctx.write("agent-tools-test-gizmo:write:forget-gizmo-high", { id: event.payload.id }),
    {
      access: { roles: ["Admin"] },
      description: "Delegates to forget-gizmo-high via ctx.write.",
    },
  );

  // Simulates the enterprise "approve" write handler: an outer, mid-risk
  // handler that itself runs the real dispatchToolCall path against a
  // tool name given as input, the way an AI-agent turn approves a queued
  // tool call.
  r.writeHandler(
    "approve",
    z.object({ toolName: z.string(), id: z.string() }),
    async (event) => {
      const manifest = buildAgentManifest(stack.registry, {
        locale: "en",
        roles: event.user.roles,
      });
      const catalog = buildToolCatalog(stack.registry, manifest, { mode: "edit" });
      // runId/toolCallId feed the write's idempotency key — must be unique
      // per call, or a second approve() reuses the first call's cached
      // WriteResult instead of actually re-dispatching the tool.
      const result = await dispatchToolCall({
        dispatcher: stack.dispatcher,
        user: event.user,
        toolName: event.payload.toolName,
        input: { id: event.payload.id },
        dispatchTable: catalog.dispatchTable,
        runId: `run-approve:${event.payload.toolName}`,
        toolCallId: `call-approve:${event.payload.id}`,
      });
      return {
        isSuccess: true as const,
        data: result.ok ? { ok: true } : { ok: false, error: result.error },
      };
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [vendorFeature, gizmoFeature] });
  await unsafeCreateEntityTable(stack.db, vendorEntity);
  await unsafeCreateEntityTable(stack.db, gizmoEntity, "gizmo");
}, 20000);

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM agent_tools_test_vendors");
  await asRawClient(stack.db).unsafe("DELETE FROM agent_tools_test_gizmos");
});

const TENANT_B = "00000000-0000-4000-8000-0000000000bb";

const adminA = createTestUser({ roles: ["Admin"] });
const adminB = createTestUser({ roles: ["Admin"], tenantId: TENANT_B });
const readerA = createTestUser({ roles: ["Reader"], id: adminA.id, tenantId: adminA.tenantId });
const noRoleA = createTestUser({ roles: [], id: adminA.id, tenantId: adminA.tenantId });

describe("dispatchToolCall — real <entity>:list pipeline", () => {
  function catalogFor(roles: readonly string[]) {
    const manifest = buildAgentManifest(stack.registry, { locale: "en", roles });
    return buildToolCatalog(stack.registry, manifest, { mode: "edit" });
  }

  test("find_vendor_by_iban never leaks another tenant's row, even on an identical IBAN", async () => {
    await stack.dispatcher.write(VENDOR_CREATE_QN, { name: "Acme A", iban: "DE-SAME" }, adminA);
    await stack.dispatcher.write(VENDOR_CREATE_QN, { name: "Acme B", iban: "DE-SAME" }, adminB);

    const catalog = catalogFor(readerA.roles);
    const result = await dispatchToolCall({
      dispatcher: stack.dispatcher,
      user: readerA,
      toolName: "find_vendor_by_iban",
      input: { iban: "DE-SAME" },
      dispatchTable: catalog.dispatchTable,
      runId: "run-1",
      toolCallId: "call-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const rows = (result.data as { rows: readonly { name: unknown }[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Acme A");
  });

  test("a caller without the list handler's required role gets denied, not an empty ok result", async () => {
    await stack.dispatcher.write(VENDOR_CREATE_QN, { name: "Acme A", iban: "DE-SAME" }, adminA);

    // Build the catalog for the READER role (the list handler's actual gate) so
    // find_vendor_by_iban is generated at all; noRoleA then calls it without any role.
    const catalog = catalogFor(readerA.roles);
    const result = await dispatchToolCall({
      dispatcher: stack.dispatcher,
      user: noRoleA,
      toolName: "find_vendor_by_iban",
      input: { iban: "DE-SAME" },
      dispatchTable: catalog.dispatchTable,
      runId: "run-1",
      toolCallId: "call-2",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("access denied");
  });
});

describe("dispatchToolCall — the invoked tool is the entry handler, not the surrounding write handler", () => {
  async function createGizmo(label: string): Promise<string> {
    const { id } = await stack.http.writeOk<{ id: string }>(GIZMO_CREATE_QN, { label }, adminA);
    return id;
  }

  async function gizmoRowExists(id: string): Promise<boolean> {
    const rows = (await asRawClient(stack.db).unsafe(
      "SELECT id FROM agent_tools_test_gizmos WHERE id = $1",
      [id],
    )) as readonly Record<string, unknown>[];
    return rows.length > 0;
  }

  test("approve (mid) invoking a high-risk forget tool succeeds — the tool is the entry, not approve", async () => {
    const id = await createGizmo("gone-after-tool-forget");
    const { ok } = await stack.http.writeOk<{ ok: boolean }>(
      "agent-tools-test-gizmo:write:approve",
      { toolName: toolNameForQn(GIZMO_FORGET_HIGH_QN), id },
      adminA,
    );
    expect(ok).toBe(true);
    expect(await gizmoRowExists(id)).toBe(false);
  });

  test("approve (mid) invoking a mid-risk tool that delegates via ctx.write to the high forget handler is denied", async () => {
    const id = await createGizmo("survives-delegated-forget");
    const { ok, error } = await stack.http.writeOk<{ ok: boolean; error?: string }>(
      "agent-tools-test-gizmo:write:approve",
      { toolName: toolNameForQn(GIZMO_DELEGATE_FORGET_MID_QN), id },
      adminA,
    );
    expect(ok).toBe(false);
    expect(error).toContain(GIZMO_DELEGATE_FORGET_MID_QN);
    expect(error).toContain("irreversible");
    expect(await gizmoRowExists(id)).toBe(true);
  });
});

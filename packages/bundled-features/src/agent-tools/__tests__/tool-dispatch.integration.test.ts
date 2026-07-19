// Proves the property the unit tests can't: dispatchToolCall runs through the
// REAL <entity>:list handler + permission pipeline, not a fake. Two things a
// hand-rolled recording dispatcher would happily hide:
//   - tenant isolation: tenant A's find_by_iban call must never surface
//     tenant B's row, even when both tenants have the exact same IBAN value.
//   - cap enforcement: a caller without the list handler's required role
//     gets denied, not an empty-but-"ok" result.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { buildToolCatalog } from "../tool-catalog";
import { dispatchToolCall } from "../tool-dispatch";

const vendorEntity = createEntity({
  table: "agent_tools_test_vendors",
  fields: {
    name: createTextField({ required: true, searchable: true, filterable: true }),
    iban: createTextField({ required: true, filterable: true }),
  },
});

const vendorFeature = defineFeature("agent-tools-test-vendor", (r) => {
  r.crud("vendor", vendorEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Reader"] } },
  });
});

const VENDOR_CREATE_QN = "agent-tools-test-vendor:write:vendor:create";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [vendorFeature] });
  await unsafeCreateEntityTable(stack.db, vendorEntity);
  await createEventsTable(stack.db);
}, 20000);

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM agent_tools_test_vendors");
});

const TENANT_B = "00000000-0000-4000-8000-0000000000bb";

const adminA = createTestUser({ roles: ["Admin"] });
const adminB = createTestUser({ roles: ["Admin"], tenantId: TENANT_B });
const readerA = createTestUser({ roles: ["Reader"], id: adminA.id, tenantId: adminA.tenantId });
const noRoleA = createTestUser({ roles: [], id: adminA.id, tenantId: adminA.tenantId });

describe("dispatchToolCall — real <entity>:list pipeline", () => {
  test("find_vendor_by_iban never leaks another tenant's row, even on an identical IBAN", async () => {
    await stack.dispatcher.write(VENDOR_CREATE_QN, { name: "Acme A", iban: "DE-SAME" }, adminA);
    await stack.dispatcher.write(VENDOR_CREATE_QN, { name: "Acme B", iban: "DE-SAME" }, adminB);

    const catalog = buildToolCatalog(stack.registry);
    const result = await dispatchToolCall(
      stack.dispatcher,
      readerA,
      "find_vendor_by_iban",
      { iban: "DE-SAME" },
      catalog.dispatchTable,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const rows = (result.data as { rows: readonly { name: unknown }[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Acme A");
  });

  test("a caller without the list handler's required role gets denied, not an empty ok result", async () => {
    await stack.dispatcher.write(VENDOR_CREATE_QN, { name: "Acme A", iban: "DE-SAME" }, adminA);

    const catalog = buildToolCatalog(stack.registry);
    const result = await dispatchToolCall(
      stack.dispatcher,
      noRoleA,
      "find_vendor_by_iban",
      { iban: "DE-SAME" },
      catalog.dispatchTable,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("access denied");
  });
});

// Dashboard Stats Sample, integration test.
// Proves: the dashboard screen boots, its panels point at a registered query,
// and that query counts per status in the database.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  TICKET_CAPABILITIES_QUERY,
  TICKET_STATS_QUERY,
  ticketEntity,
  ticketFeature,
} from "../feature";

let stack: TestStack;

const admin = createTestUser({ roles: ["Admin"], tenantId: testTenantId(31) });

beforeAll(async () => {
  stack = await setupTestStack({ features: [ticketFeature] });
  await unsafeCreateEntityTable(stack.db, ticketEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("dashboard screen", () => {
  test("boots, and every stat reads a field the stats query returns", async () => {
    const screen = ticketFeature.screens["ticket-dashboard"];
    if (screen?.type !== "dashboard") throw new Error("ticket-dashboard is not a dashboard screen");

    const stats = screen.panels.flatMap((panel) =>
      panel.kind === "stat-group" ? panel.stats : panel.kind === "stat" ? [panel] : [],
    );
    expect(stats.map((s) => s.valueField)).toEqual(["open", "closed", "total"]);
    for (const stat of stats) expect(stat.query).toBe(TICKET_STATS_QUERY);

    const result = await stack.http.queryOk<Record<string, unknown>>(TICKET_STATS_QUERY, {}, admin);
    for (const stat of stats) expect(result).toHaveProperty(stat.valueField);
  });
});

describe("ticket:stats", () => {
  test("counts open and closed tickets in the database", async () => {
    for (const [title, status] of [
      ["a", "open"],
      ["b", "open"],
      ["c", "open"],
      ["d", "closed"],
      ["e", "closed"],
    ] as const) {
      await stack.http.writeOk<SaveContext>(
        "tickets:write:ticket:create",
        { title, status },
        admin,
      );
    }

    const result = await stack.http.queryOk<Record<string, unknown>>(TICKET_STATS_QUERY, {}, admin);

    expect(result).toEqual({ open: 3, closed: 2, total: 5 });
  });
});

describe("record-bound dashboard with a gated detail panel", () => {
  test("the dashboard embeds the detail screen and the gate answers per role", async () => {
    const dashboard = ticketFeature.screens["ticket-record-dashboard"];
    if (dashboard?.type !== "dashboard") throw new Error("ticket-record-dashboard missing");
    expect(dashboard.record).toEqual({ param: "ticketId", payloadKey: "id" });
    expect(dashboard.panels.map((panel) => panel.kind)).toEqual(["screen"]);

    const card = ticketFeature.screens["ticket-card"];
    expect(card?.fallback).toEqual({ forbidden: "ticket-list", notFound: "ticket-list" });

    const adminGate = await stack.http.queryOk<{ canClose: boolean }>(
      TICKET_CAPABILITIES_QUERY,
      {},
      admin,
    );
    expect(adminGate.canClose).toBe(true);
    const user = createTestUser({ roles: ["User"], tenantId: testTenantId(31) });
    const userGate = await stack.http.queryOk<{ canClose: boolean }>(
      TICKET_CAPABILITIES_QUERY,
      {},
      user,
    );
    expect(userGate.canClose).toBe(false);
  });

  test("the toolbar button carries the same gate", () => {
    const list = ticketFeature.screens["ticket-list"];
    if (list?.type !== "projectionList") throw new Error("ticket-list missing");
    expect(list.toolbarActions?.[0]?.visibleWhen).toEqual({
      query: TICKET_CAPABILITIES_QUERY,
      field: "canClose",
      eq: true,
    });
  });
});

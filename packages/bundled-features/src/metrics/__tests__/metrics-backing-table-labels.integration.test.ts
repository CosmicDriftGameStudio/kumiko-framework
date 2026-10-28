import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createMetricsFeature } from "../feature.ts";
import { defineMetric, type MetricResult } from "../types.ts";
import { metricQueryName } from "../web/constants.ts";
import { TENANT_A } from "./metrics-fixtures.ts";

const nameField = createTextField({ required: true, personal: false, reason: "test_fixture" });

const teamEntity = createEntity({
  table: "metrics_bt_teams",
  fields: { name: nameField },
});
const ticketEntity = createEntity({
  table: "metrics_bt_tickets",
  fields: {
    teamId: { type: "reference", entity: "metricsbtteams:team", labelField: "name" } as const,
  },
});
// The physical table is not the one the entity's own `table` names: apps point an entity at a
// hand-picked backing table, and metrics read from that one.
const backingEntity = { ...ticketEntity, table: "metrics_bt_tickets_backing" };
const teamTable = buildEntityTable("team", teamEntity);
const backingTicketTable = buildEntityTable("ticket", backingEntity);

const teamsFeature = defineFeature("metricsbtteams", (r) => {
  r.entity({ name: "team", ...teamEntity });
});
const ticketsFeature = defineFeature("metricsbttickets", (r) => {
  r.requires({ features: ["metricsbtteams"] });
  r.entity({ name: "ticket", ...ticketEntity, backingTable: backingTicketTable });
});

const TEAM_SUPPORT = "aaaaaaaa-0000-4000-8000-0000000000b1";

const ticketsPerTeam = defineMetric({
  id: "bt-tickets-per-team",
  description: "Tickets per team, read from the entity's backing table",
  source: backingTicketTable,
  measure: { fn: "count" },
  groupBy: "teamId",
  scopes: ["tenant"],
});

const admin = createTestUser({ id: 7301, tenantId: TENANT_A, roles: ["TenantAdmin"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [teamsFeature, ticketsFeature, createMetricsFeature({ metrics: [ticketsPerTeam] })],
  });
  await unsafeCreateEntityTable(stack.db, teamEntity, "team");
  await unsafeCreateEntityTable(stack.db, backingEntity, "ticket");
  await seedRows(stack.db, teamTable, [{ id: TEAM_SUPPORT, tenantId: TENANT_A, name: "Support" }]);
  await seedRows(stack.db, backingTicketTable, [
    { tenantId: TENANT_A, teamId: TEAM_SUPPORT },
    { tenantId: TENANT_A, teamId: TEAM_SUPPORT },
  ]);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("metric reference labels over a backing table", () => {
  test("group rows carry the referenced name although the entity table differs from the source", async () => {
    const result = await stack.http.queryOk<MetricResult>(
      metricQueryName("tenant", ticketsPerTeam.id),
      { range: "7d" },
      admin,
    );
    expect(result.rows.find((row) => row.key === TEAM_SUPPORT)?.label).toBe("Support");
  });
});

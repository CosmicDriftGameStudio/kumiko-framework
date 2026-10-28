import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineUnmanagedTable, insertOne } from "@cosmicdrift/kumiko-framework/db";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createMetricsFeature } from "../feature.ts";
import { defineMetric, type MetricResult } from "../types.ts";
import { metricQueryName } from "../web/constants.ts";
import { TENANT_A, TENANT_B } from "./metrics-fixtures.ts";

const teamsTable = defineUnmanagedTable({
  tableName: "store_metrics_teams_it",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "name", pgType: "text", notNull: true },
  ],
});

const ticketsTable = defineUnmanagedTable({
  tableName: "store_metrics_tickets_it",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "team_id", pgType: "uuid", notNull: true },
  ],
});

const TEAM_A_SUPPORT = "aaaaaaaa-0000-4000-8000-000000000001";
const TEAM_A_SALES = "aaaaaaaa-0000-4000-8000-000000000002";
const TEAM_B_FOREIGN = "bbbbbbbb-0000-4000-8000-000000000001";

const ticketsPerTeam = defineMetric({
  id: "tickets-per-team",
  description: "Tickets per team, named after the team",
  source: ticketsTable,
  measure: { fn: "count" },
  groupBy: "teamId",
  groupLabelsFrom: { source: teamsTable, labelField: "name" },
  access: { roles: ["Staff"] },
  scopes: ["tenant"],
});

const ticketsPerTeamAdminOnly = defineMetric({
  ...ticketsPerTeam,
  id: "tickets-per-team-admin",
  groupLabels: { [TEAM_A_SALES]: "metrics:static.label" },
  access: undefined,
});

const staffA = createTestUser({ id: 7201, tenantId: TENANT_A, roles: ["Staff"] });
const plainUserA = createTestUser({ id: 7202, tenantId: TENANT_A, roles: ["User"] });
const tenantAdminA = createTestUser({ id: 7203, tenantId: TENANT_A, roles: ["TenantAdmin"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createMetricsFeature({ metrics: [ticketsPerTeam, ticketsPerTeamAdminOnly] })],
  });
  await unsafePushTables(stack.db, { teamsTable, ticketsTable });
  await insertOne(stack.db, teamsTable, {
    id: TEAM_A_SUPPORT,
    tenantId: TENANT_A,
    name: "Support",
  });
  await insertOne(stack.db, teamsTable, { id: TEAM_A_SALES, tenantId: TENANT_A, name: "Sales" });
  await insertOne(stack.db, teamsTable, {
    id: TEAM_B_FOREIGN,
    tenantId: TENANT_B,
    name: "Secret B",
  });
  for (const teamId of [TEAM_A_SUPPORT, TEAM_A_SUPPORT, TEAM_A_SALES, TEAM_B_FOREIGN]) {
    await insertOne(stack.db, ticketsTable, { tenantId: TENANT_A, teamId });
  }
});

afterAll(async () => {
  await stack.cleanup();
});

const run = (id: string, user: typeof staffA) =>
  stack.http.queryOk<MetricResult>(metricQueryName("tenant", id), { range: "7d" }, user);

describe("metric access", () => {
  test("a role named in access reads the metric, a plain user does not", async () => {
    const result = await run(ticketsPerTeam.id, staffA);
    expect(result.value).toBe(4);
    const denied = await stack.http.query(
      metricQueryName("tenant", ticketsPerTeam.id),
      { range: "7d" },
      plainUserA,
    );
    expect(denied.status).toBe(403);
  });

  test("access replaces the admin default: a TenantAdmin without the role is denied", async () => {
    const denied = await stack.http.query(
      metricQueryName("tenant", ticketsPerTeam.id),
      { range: "7d" },
      tenantAdminA,
    );
    expect(denied.status).toBe(403);
  });

  test("without access the metric stays admin-only", async () => {
    const asStaff = await stack.http.query(
      metricQueryName("tenant", ticketsPerTeamAdminOnly.id),
      { range: "7d" },
      staffA,
    );
    expect(asStaff.status).toBe(403);
    const asAdmin = await run(ticketsPerTeamAdminOnly.id, tenantAdminA);
    expect(asAdmin.value).toBe(4);
  });
});

describe("metric groupLabelsFrom", () => {
  test("group rows carry the name of the referenced row", async () => {
    const result = await run(ticketsPerTeam.id, staffA);
    const labelOfKey = Object.fromEntries(result.rows.map((row) => [row.key, row.label]));
    expect(labelOfKey[TEAM_A_SUPPORT]).toBe("Support");
    expect(labelOfKey[TEAM_A_SALES]).toBe("Sales");
  });

  test("a referenced row of another tenant is not resolved: the key stays the label", async () => {
    const result = await run(ticketsPerTeam.id, staffA);
    const foreign = result.rows.find((row) => row.key === TEAM_B_FOREIGN);
    expect(foreign?.label).toBe(TEAM_B_FOREIGN);
    expect(JSON.stringify(result)).not.toContain("Secret B");
  });

  test("a static groupLabels entry wins over the referenced name", async () => {
    const result = await run(ticketsPerTeamAdminOnly.id, tenantAdminA);
    const sales = result.rows.find((row) => row.key === TEAM_A_SALES);
    expect(sales?.label).toBe("metrics:static.label");
    expect(result.rows.find((row) => row.key === TEAM_A_SUPPORT)?.label).toBe("Support");
  });
});

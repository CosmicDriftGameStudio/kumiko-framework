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
import { TENANT_A, TENANT_B } from "./metrics-fixtures.ts";

const nameField = createTextField({ required: true, personal: false, reason: "test_fixture" });

// Staff may read teams, only Admin may read vault teams.
const teamEntity = createEntity({
  table: "metrics_labels_teams",
  access: { read: { Staff: "all", TenantAdmin: "all" } },
  fields: { name: nameField },
});
const vaultTeamEntity = createEntity({
  table: "metrics_labels_vault_teams",
  access: { read: { Admin: "all" } },
  fields: { name: nameField },
});
const ticketEntity = createEntity({
  table: "metrics_labels_tickets",
  fields: {
    teamId: { type: "reference", entity: "metricslabelsteams:team", labelField: "name" } as const,
    vaultTeamId: {
      type: "reference",
      entity: "metricslabelsteams:vaultTeam",
      labelField: "name",
    } as const,
  },
});
const teamTable = buildEntityTable("team", teamEntity);
const vaultTeamTable = buildEntityTable("vaultTeam", vaultTeamEntity);
const ticketTable = buildEntityTable("ticket", ticketEntity);

const teamsFeature = defineFeature("metricslabelsteams", (r) => {
  r.entity({ name: "team", ...teamEntity });
  r.entity({ name: "vaultTeam", ...vaultTeamEntity });
});
const ticketsFeature = defineFeature("metricslabelstickets", (r) => {
  r.requires({ features: ["metricslabelsteams"] });
  r.entity({ name: "ticket", ...ticketEntity });
});

const TEAM_A_SUPPORT = "aaaaaaaa-0000-4000-8000-000000000001";
const TEAM_A_SALES = "aaaaaaaa-0000-4000-8000-000000000002";
const TEAM_B_FOREIGN = "bbbbbbbb-0000-4000-8000-000000000001";
const VAULT_A = "cccccccc-0000-4000-8000-000000000001";

const ticketsPerTeam = defineMetric({
  id: "tickets-per-team",
  description: "Tickets per team, named after the team",
  source: ticketTable,
  measure: { fn: "count" },
  groupBy: "teamId",
  access: { roles: ["Staff"] },
  scopes: ["tenant"],
});

const ticketsPerTeamAdminOnly = defineMetric({
  ...ticketsPerTeam,
  id: "tickets-per-team-admin",
  groupLabels: { [TEAM_A_SALES]: "metrics:static.label" },
  access: undefined,
});

const ticketsPerVaultTeam = defineMetric({
  ...ticketsPerTeam,
  id: "tickets-per-vault-team",
  groupBy: "vaultTeamId",
});

const staffA = createTestUser({ id: 7201, tenantId: TENANT_A, roles: ["Staff"] });
const plainUserA = createTestUser({ id: 7202, tenantId: TENANT_A, roles: ["User"] });
const tenantAdminA = createTestUser({ id: 7203, tenantId: TENANT_A, roles: ["TenantAdmin"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      teamsFeature,
      ticketsFeature,
      createMetricsFeature({
        metrics: [ticketsPerTeam, ticketsPerTeamAdminOnly, ticketsPerVaultTeam],
      }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, teamEntity, "team");
  await unsafeCreateEntityTable(stack.db, vaultTeamEntity, "vaultTeam");
  await unsafeCreateEntityTable(stack.db, ticketEntity, "ticket");
  await seedRows(stack.db, teamTable, [
    { id: TEAM_A_SUPPORT, tenantId: TENANT_A, name: "Support" },
    { id: TEAM_A_SALES, tenantId: TENANT_A, name: "Sales" },
    { id: TEAM_B_FOREIGN, tenantId: TENANT_B, name: "Secret B" },
  ]);
  await seedRows(stack.db, vaultTeamTable, [{ id: VAULT_A, tenantId: TENANT_A, name: "Vault A" }]);
  await seedRows(
    stack.db,
    ticketTable,
    [TEAM_A_SUPPORT, TEAM_A_SUPPORT, TEAM_A_SALES, TEAM_B_FOREIGN].map((teamId) => ({
      tenantId: TENANT_A,
      teamId,
      vaultTeamId: VAULT_A,
    })),
  );
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

describe("metric reference labels", () => {
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

  test("a referenced row the viewer may not read keeps its key as label", async () => {
    const result = await run(ticketsPerVaultTeam.id, staffA);
    expect(result.rows.map((row) => row.label)).toEqual([VAULT_A]);
    expect(JSON.stringify(result)).not.toContain("Vault A");
  });
});

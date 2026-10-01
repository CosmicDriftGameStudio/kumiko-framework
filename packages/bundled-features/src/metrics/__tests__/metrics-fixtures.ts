import { defineUnmanagedTable, insertOne } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/stack";
import { Temporal } from "temporal-polyfill";
import { defineMetric, type MetricDefinition } from "../types.js";

export const eventsTable = defineUnmanagedTable({
  tableName: "store_metrics_events_it",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "status", pgType: "text", notNull: true },
    { name: "user_ref", pgType: "text", notNull: true },
    { name: "amount", pgType: "integer", notNull: true },
    { name: "created_at", pgType: "timestamptz", notNull: true },
  ],
});

// No tenant_id column: only usable in system scope.
export const globalTable = defineUnmanagedTable({
  tableName: "store_metrics_global_it",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "kind", pgType: "text", notNull: true },
  ],
});

export const TENANT_A = testTenantId(7001);
export const TENANT_B = testTenantId(7002);
export const TENANT_C = testTenantId(7003);
export const TENANT_D = testTenantId(7004);

export const NOW = Temporal.Instant.from("2026-03-10T12:30:00Z");
export const fixedClock = (): Temporal.Instant => NOW;

type SeedRow = {
  readonly tenantId: string;
  readonly status: string;
  readonly userRef: string;
  readonly amount: number;
  readonly createdAt: string;
};

const row = (
  tenantId: string,
  status: string,
  userRef: string,
  amount: number,
  createdAt: string,
): SeedRow => ({ tenantId, status, userRef, amount, createdAt });

const MANY_USERS = 55;
export const SYSTEM_ROW_COUNT = 2;

const seedRows: readonly SeedRow[] = [
  row(TENANT_A, "ok", "u1", 10, "2026-03-10T10:15:00Z"),
  row(TENANT_A, "ok", "u1", 20, "2026-03-10T10:45:00Z"),
  row(TENANT_A, "failed", "u2", 30, "2026-03-10T11:05:00Z"),
  row(TENANT_A, "ok", "u2", 40, "2026-03-09T20:00:00Z"),
  row(TENANT_A, "failed", "u3", 50, "2026-03-09T05:00:00Z"),
  row(TENANT_A, "ok", "u3", 5, "2026-03-02T00:00:00Z"),
  row(TENANT_B, "ok", "u9", 1000, "2026-03-10T10:15:00Z"),
  // 00:30 on 10 March in Europe/Berlin, still 9 March in UTC.
  row(TENANT_C, "ok", "u1", 100, "2026-03-09T23:30:00Z"),
  row(TENANT_C, "ok", "u1", 200, "2026-03-10T10:00:00Z"),
  // SYSTEM_TENANT_ID rows inside the 24h window: tenant reads must exclude them.
  row(SYSTEM_TENANT_ID, "ok", "sys1", 7, "2026-03-10T10:20:00Z"),
  row(SYSTEM_TENANT_ID, "ok", "sys2", 7, "2026-03-10T10:40:00Z"),
  ...Array.from({ length: MANY_USERS }, (_, index) =>
    row(TENANT_D, "ok", `many-${String(index).padStart(2, "0")}`, 1, "2026-03-10T09:00:00Z"),
  ),
];

type TestDb = Parameters<typeof insertOne>[0];

export async function seedMetricRows(db: TestDb): Promise<void> {
  for (const seed of seedRows) {
    await insertOne(db, eventsTable, { ...seed, createdAt: Temporal.Instant.from(seed.createdAt) });
  }
  await insertOne(db, globalTable, { kind: "a" });
  await insertOne(db, globalTable, { kind: "b" });
}

const bothScopes = ["tenant", "system"] as const;

export const countMetric = defineMetric({
  id: "events-count",
  description: "Events per bucket",
  source: eventsTable,
  measure: { fn: "count" },
  timeField: "createdAt",
  bucket: "auto",
  scopes: bothScopes,
});

export const byStatusMetric = defineMetric({
  id: "events-by-status",
  description: "Events per status",
  source: eventsTable,
  measure: { fn: "count" },
  timeField: "createdAt",
  groupBy: "status",
  groupLabels: { ok: "metrics:jobStatus.completed" },
  scopes: bothScopes,
});

export const byStatusOverTimeMetric = defineMetric({
  id: "events-by-status-over-time",
  description: "Events per status and day",
  source: eventsTable,
  measure: { fn: "count" },
  timeField: "createdAt",
  bucket: "day",
  groupBy: "status",
  scopes: bothScopes,
});

export const stackedMetric = defineMetric({
  id: "events-by-user-stacked",
  description: "Events per user stacked by status",
  source: eventsTable,
  measure: { fn: "count" },
  timeField: "createdAt",
  groupBy: "userRef",
  stackBy: "status",
  scopes: bothScopes,
});

export const usersMetric = defineMetric({
  id: "events-users",
  description: "Distinct users per day",
  source: eventsTable,
  measure: { fn: "countDistinct", field: "userRef" },
  timeField: "createdAt",
  window: "7d",
  bucket: "day",
  scopes: bothScopes,
});

export const usersWithoutComparisonMetric = defineMetric({
  ...usersMetric,
  id: "events-users-no-comparison",
  comparePrevious: false,
});

export const amountMetric = defineMetric({
  id: "events-amount",
  description: "Summed amount",
  source: eventsTable,
  measure: { fn: "sum", field: "amount" },
  timeField: "createdAt",
  scopes: bothScopes,
});

export const averageMetric = defineMetric({
  id: "events-average",
  description: "Average amount per day",
  source: eventsTable,
  measure: { fn: "avg", field: "amount" },
  timeField: "createdAt",
  window: "7d",
  bucket: "day",
  scopes: bothScopes,
});

export const snapshotMetric = defineMetric({
  id: "events-snapshot",
  description: "Successful events, no window",
  source: eventsTable,
  measure: { fn: "count" },
  where: { status: "ok" },
  scopes: bothScopes,
});

export const manyUsersMetric = defineMetric({
  id: "events-by-user",
  description: "Events per user",
  source: eventsTable,
  measure: { fn: "count" },
  timeField: "createdAt",
  groupBy: "userRef",
  scopes: bothScopes,
});

export const globalMetric = defineMetric({
  id: "global-count",
  description: "Rows of a table without tenant column",
  source: globalTable,
  measure: { fn: "count" },
  scopes: ["system"],
});

export const ALL_TEST_METRICS: readonly MetricDefinition[] = [
  countMetric,
  byStatusMetric,
  byStatusOverTimeMetric,
  stackedMetric,
  usersMetric,
  usersWithoutComparisonMetric,
  amountMetric,
  averageMetric,
  snapshotMetric,
  manyUsersMetric,
  globalMetric,
];

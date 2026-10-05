import { defineUnmanagedTable, insertOne } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
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

export const filesTable = defineUnmanagedTable({
  tableName: "store_metrics_files_it",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "folder_id", pgType: "uuid", notNull: true },
    { name: "kind", pgType: "text", notNull: true },
    { name: "size_class", pgType: "integer", notNull: true },
    { name: "archived", pgType: "boolean", notNull: true },
  ],
});

export const FOLDER_A1 = "11111111-1111-4111-8111-111111111111";
export const FOLDER_A2 = "22222222-2222-4222-8222-222222222222";
export const FOLDER_B1 = "33333333-3333-4333-8333-333333333333";

const fileRows = [
  { tenantId: TENANT_A, folderId: FOLDER_A1, kind: "pdf", sizeClass: 1, archived: false },
  { tenantId: TENANT_A, folderId: FOLDER_A1, kind: "png", sizeClass: 2, archived: false },
  { tenantId: TENANT_A, folderId: FOLDER_A2, kind: "pdf", sizeClass: 1, archived: false },
  { tenantId: TENANT_A, folderId: FOLDER_A2, kind: "pdf", sizeClass: 1, archived: true },
  { tenantId: TENANT_B, folderId: FOLDER_B1, kind: "pdf", sizeClass: 1, archived: false },
  { tenantId: TENANT_B, folderId: FOLDER_B1, kind: "pdf", sizeClass: 2, archived: false },
  { tenantId: TENANT_B, folderId: FOLDER_B1, kind: "png", sizeClass: 2, archived: false },
  { tenantId: TENANT_B, folderId: FOLDER_B1, kind: "png", sizeClass: 2, archived: false },
];

export async function seedFileRows(db: TestDb): Promise<void> {
  for (const file of fileRows) await insertOne(db, filesTable, file);
}

export const filesByKindMetric = defineMetric({
  id: "files-by-kind",
  description: "Active files per kind, narrowable by folder, kind and size class",
  source: filesTable,
  measure: { fn: "count" },
  where: { archived: false },
  groupBy: "kind",
  filters: { folderId: "folderId", kind: "kind", sizeClass: "sizeClass" },
  scopes: bothScopes,
});

export const filesCountMetric = defineMetric({
  id: "files-count",
  description: "Active files, narrowable by folder",
  source: filesTable,
  measure: { fn: "count" },
  where: { archived: false },
  filters: { folderId: "folderId" },
  scopes: bothScopes,
});

export const folderTreeTable = defineUnmanagedTable({
  tableName: "store_metrics_folder_tree_it",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "parent_id", pgType: "uuid", notNull: true },
    { name: "child_id", pgType: "uuid", notNull: true },
  ],
});

const folderTreeRows = [
  { tenantId: TENANT_A, parentId: FOLDER_A1, childId: FOLDER_A1 },
  { tenantId: TENANT_A, parentId: FOLDER_A1, childId: FOLDER_A2 },
  { tenantId: TENANT_B, parentId: FOLDER_B1, childId: FOLDER_B1 },
];

export async function seedFolderTreeRows(db: TestDb): Promise<void> {
  for (const row of folderTreeRows) await insertOne(db, folderTreeTable, row);
}

export const filesInFolderTreeMetric = defineMetric({
  id: "files-in-folder-tree",
  description: "Active files in a folder and its subfolders (assignment table)",
  source: filesTable,
  measure: { fn: "count" },
  where: { archived: false },
  filters: {
    treeFolderId: {
      column: "folderId",
      valueKind: "uuid",
      resolve: async (folderId, ctx) => {
        const rows = await ctx.db.selectMany(folderTreeTable, { parentId: folderId });
        return rows.flatMap((row) => (typeof row["childId"] === "string" ? [row["childId"]] : []));
      },
    },
  },
  scopes: ["tenant"],
});

export const filesWithForeignIdsMetric = defineMetric({
  id: "files-foreign-resolver",
  description: "Resolver that returns another tenant's folder id",
  source: filesTable,
  measure: { fn: "count" },
  where: { archived: false },
  filters: {
    anyFolder: { column: "folderId", valueKind: "string", resolve: async () => [FOLDER_B1] },
  },
  scopes: ["tenant"],
});

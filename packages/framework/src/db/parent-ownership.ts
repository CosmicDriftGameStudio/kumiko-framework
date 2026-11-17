import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import {
  buildOwnershipClause,
  columnSqlName,
  normalizeAccessEntry,
  type OwnershipMap,
  type OwnershipRule,
  type ParentRuleResolver,
  parentRuleOfRole,
  tableNameOf,
} from "../engine/ownership.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import type { Table } from "./event-store-executor-context.ts";
import type { ParentVisibilityOption } from "./parent-ref-clause.ts";
import { executeRawQueryRead } from "./queries/raw-sql.ts";
import { quoteIdent } from "./sql-identifier.ts";
import { buildEntityTable } from "./table-builder.ts";
import type { TenantDb } from "./tenant-db.ts";
import { tenantDbRunnerForTable } from "./tenant-db-runner.ts";

// Building the table is pure but not free, and runs on every search request;
// keyed by the definition object so a re-registered entity never sees a stale table.
const referenceTargetTables = new WeakMap<EntityDefinition, { name: string; table: Table }>();

export function referenceTargetTable(name: string, entity: EntityDefinition): Table {
  const cached = referenceTargetTables.get(entity);
  if (cached?.name === name) return cached.table;
  const table = buildEntityTable(name, entity);
  referenceTargetTables.set(entity, { name, table });
  return table;
}

export function findImplicitEntityTable(
  registry: Pick<Registry, "getAllProjections">,
  entityType: string,
) {
  for (const projection of registry.getAllProjections().values()) {
    if (projection.isImplicit === true && projection.source === entityType) {
      return projection.table;
    }
  }
  return undefined;
}

type AccessSide = "read" | "write";

function accessMapOf(entity: EntityDefinition, access: AccessSide): OwnershipMap | undefined {
  return normalizeAccessEntry(entity.access?.[access]);
}

export function parentRulesFromOption(
  option: ParentVisibilityOption | undefined,
  access: AccessSide,
): ParentRuleResolver | undefined {
  if (option === undefined) return undefined;
  return (name) => {
    const entity = option.entities.get(name);
    if (entity === undefined) return undefined;
    const table = option.resolveTable?.(name) ?? referenceTargetTable(name, entity);
    return { accessMap: accessMapOf(entity, access), table, tableName: tableNameOf(table) };
  };
}

export function parentRulesFromRegistry(
  registry: Pick<Registry, "getEntity" | "getAllProjections">,
  access: AccessSide,
): ParentRuleResolver {
  return (name) => {
    const entity = registry.getEntity(name);
    if (entity === undefined) return undefined;
    const table = findImplicitEntityTable(registry, name);
    if (table === undefined) return undefined;
    return { accessMap: accessMapOf(entity, access), table, tableName: tableNameOf(table) };
  };
}

function hasParentRule(accessMap: OwnershipMap): boolean {
  return Object.values(accessMap).some((rule) => rule !== "all" && rule.kind === "parent");
}

function parentIdOf(row: Readonly<Record<string, unknown>>, field: string): string | undefined {
  const value = row[field];
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

// A parent rule grants nothing in memory; here it is resolved against the stored parent rows. The
// role's rule becomes "all" only when EVERY row (old and new parent on an update) points at a
// parent that same role may write, which keeps the per-role straddle rule of the in-memory check.
export async function resolveParentWriteAccess(input: {
  readonly accessMap: OwnershipMap | undefined;
  readonly user: SessionUser;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly db: TenantDb;
  readonly parents: ParentRuleResolver | undefined;
}): Promise<OwnershipMap | undefined> {
  const { accessMap, user, rows, db, parents } = input;
  if (accessMap === undefined || !hasParentRule(accessMap)) return accessMap;

  const cache = new Map<string, Promise<boolean>>();
  const mayWriteParent = (
    role: string,
    entityName: string,
    parentId: string,
  ): Promise<boolean> => {
    const key = `${role}\u0000${entityName}\u0000${parentId}`;
    let result = cache.get(key);
    if (result === undefined) {
      result = parentWritableByRole({ role, entityName, parentId, user, db, parents });
      cache.set(key, result);
    }
    return result;
  };

  const resolved: Record<string, OwnershipRule> = { ...accessMap };
  for (const [role, rule] of Object.entries(accessMap)) {
    if (rule === "all" || rule.kind !== "parent") continue;
    if (!user.roles.includes(role)) continue;
    let everyParentWritable = rows.length > 0;
    for (const row of rows) {
      const parentId = parentIdOf(row, rule.field);
      if (parentId === undefined || !(await mayWriteParent(role, rule.entity, parentId))) {
        everyParentWritable = false;
        break;
      }
    }
    if (everyParentWritable) resolved[role] = "all";
  }
  return resolved;
}

async function parentWritableByRole(input: {
  readonly role: string;
  readonly entityName: string;
  readonly parentId: string;
  readonly user: SessionUser;
  readonly db: TenantDb;
  readonly parents: ParentRuleResolver | undefined;
}): Promise<boolean> {
  const { role, entityName, parentId, user, db, parents } = input;
  const target = parents?.(entityName);
  if (target === undefined) return false;
  const parentRule = parentRuleOfRole(target.accessMap, role);
  if (parentRule === undefined) return false;

  const parentTable = quoteIdent(target.tableName);
  const params: unknown[] = [parentId];
  let tenantClause = "";
  const tenantColumn = columnSqlName(target.table, "tenantId");
  if (tenantColumn !== null && db.mode === "tenant") {
    params.push(db.tenantId);
    tenantClause = ` AND ${parentTable}.${quoteIdent(tenantColumn)} = $${params.length}`;
  }
  const clause = buildOwnershipClause(
    user,
    { [role]: parentRule },
    target.table,
    params.length + 1,
    target.tableName,
    parents,
  );
  if (clause.kind === "empty") return false;
  let ownershipClause = "";
  if (clause.kind === "sql") {
    ownershipClause = ` AND (${clause.sqlText})`;
    params.push(...clause.params);
  }
  const rows = await executeRawQueryRead(
    tenantDbRunnerForTable(db, target.table),
    `SELECT 1 FROM ${parentTable} WHERE ${parentTable}."id" = $1${tenantClause}${ownershipClause} LIMIT 1`,
    params,
  );
  return rows.length > 0;
}

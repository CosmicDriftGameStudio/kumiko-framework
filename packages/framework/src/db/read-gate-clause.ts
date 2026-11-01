import type { ParentVisibilityOption } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { isFileField } from "../engine/field-helpers.ts";
import {
  buildOwnershipClause,
  combineClauses,
  normalizeAccessEntry,
  type OwnershipClause,
  shiftParams,
} from "../engine/ownership.ts";
import { SYSTEM_TENANT_ID, UUID_SHAPE_PATTERN } from "../engine/types/identifiers.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { FILE_REF_ENTITY_NAME } from "../files/types.ts";
import type { Table } from "./event-store-executor-context.ts";
import { isFrameworkSystemUser } from "./lock-guard.ts";
import { buildParentRefClause } from "./parent-ref-clause.ts";
import { buildEntityTable, physicalColumnName } from "./table-builder.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";

const PASS: OwnershipClause = { kind: "pass" };
const EMPTY: OwnershipClause = { kind: "empty" };
const LINK_ALIAS = "gate_link";
const FILE_ALIAS = "gate_file";

type GateInput = {
  readonly entity: EntityDefinition;
  readonly table: Table;
  // The alias the gated table carries in the caller's SQL.
  readonly tableName: string;
  readonly user: SessionUser;
  readonly db: TenantDb;
  readonly option: ParentVisibilityOption;
};

// Placeholders are numbered from 1 per gate fragment; combineClauses shifts them into the
// caller's statement, so every embedded fragment is shifted past the params collected so far.
class GateSql {
  readonly params: unknown[] = [];

  bind(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  embed(clause: OwnershipClause & { readonly kind: "sql" }): string {
    const shifted = shiftParams(
      { sqlText: clause.sqlText, params: clause.params },
      this.params.length,
    );
    this.params.push(...shifted.params);
    return shifted.sqlText;
  }
}

function tableOf(option: ParentVisibilityOption, name: string, entity: EntityDefinition): Table {
  return option.resolveTable?.(name) ?? buildEntityTable(name, entity);
}

function tenantScopeSql(sql: GateSql, db: TenantDb, table: Table, alias: string): string[] {
  if (table["tenantId"] === undefined || db.mode !== "tenant") return [];
  const first = sql.bind(db.tenantId);
  const second = sql.bind(SYSTEM_TENANT_ID);
  return [`"${alias}"."${physicalColumnName(table, "tenantId")}" IN (${first}, ${second})`];
}

function liveRowSql(entity: EntityDefinition, table: Table, alias: string): string[] {
  if (entity.softDelete !== true || table["isDeleted"] === undefined) return [];
  return [`"${alias}"."${physicalColumnName(table, "isDeleted")}" = FALSE`];
}

function isRoleExempt(gate: NonNullable<EntityDefinition["readGate"]>, user: SessionUser): boolean {
  return user.roles.some((role) => gate.linkExemptRoles?.includes(role) === true);
}

type GateLink = { readonly entity: string; readonly field: string };

// "any": one readable live link suffices. "all": additionally no live link may be unreadable;
// COALESCE keeps a NULL from the ownership SQL from counting as readable.
function linkClause(input: GateInput, link: GateLink, mode: "any" | "all"): OwnershipClause {
  const { option, user, db, tableName } = input;
  const linkEntity = option.entities.get(link.entity);
  if (linkEntity?.parentRef === undefined) return EMPTY;
  const linkTable = tableOf(option, link.entity, linkEntity);
  const linkTableName = String(schemaTableName(linkTable));
  const linkOwnership = combineClauses(
    buildOwnershipClause(user, linkEntity.access?.read, linkTable, 1, LINK_ALIAS),
    buildParentRefClause(linkEntity, linkTable, LINK_ALIAS, user, db, option, {
      includeDeleted: false,
      requireReadHandler: true,
    }),
  );
  if (linkOwnership.kind === "empty") return EMPTY;

  const sql = new GateSql();
  const linkRowsOfThisRow = () => [
    `"${LINK_ALIAS}"."${physicalColumnName(linkTable, link.field)}"::text = "${tableName}"."${physicalColumnName(input.table, "id")}"::text`,
    ...tenantScopeSql(sql, db, linkTable, LINK_ALIAS),
    ...liveRowSql(linkEntity, linkTable, LINK_ALIAS),
  ];
  const existsLink = (conditions: readonly string[]) =>
    `EXISTS (SELECT 1 FROM "${linkTableName}" AS "${LINK_ALIAS}" WHERE ${conditions.join(" AND ")})`;

  const readable = linkRowsOfThisRow();
  if (linkOwnership.kind === "sql") readable.push(sql.embed(linkOwnership));
  let sqlText = existsLink(readable);
  if (mode === "all" && linkOwnership.kind === "sql") {
    const unreadable = [
      ...linkRowsOfThisRow(),
      `NOT COALESCE((${sql.embed(linkOwnership)}), FALSE)`,
    ];
    sqlText = `(${sqlText} AND NOT ${existsLink(unreadable)})`;
  }
  return { kind: "sql", sqlText, params: sql.params };
}

type OwnerCandidate = {
  readonly name: string;
  readonly entity: EntityDefinition;
  readonly table: Table;
  readonly fileFields: readonly string[];
};

type OwnerSource = {
  readonly name: string;
  readonly entity: EntityDefinition;
  readonly projectionTable?: Table;
};

function hasRowReadRule(entity: EntityDefinition): boolean {
  return Object.keys(entity.access?.read ?? {}).length > 0;
}

// A read model is served by hand-written queries that filter rows themselves; only its own
// access.read can be reproduced here, so without one every role of its detail query would read every row.
function ownerSources(option: ParentVisibilityOption): OwnerSource[] {
  const sources: OwnerSource[] = [...option.entities].map(([name, entity]) => ({ name, entity }));
  for (const [name, { entity, table }] of option.readModelEntities ?? []) {
    if (!option.entities.has(name) && hasRowReadRule(entity)) {
      sources.push({ name, entity, projectionTable: table });
    }
  }
  return sources;
}

// Join rows and gated entities are left out: their readability is not resolvable without recursion.
function ownerCandidates(input: GateInput, selfName: string | undefined): OwnerCandidate[] {
  const { option } = input;
  const owners: OwnerCandidate[] = [];
  for (const { name, entity, projectionTable } of ownerSources(option)) {
    if (name === FILE_REF_ENTITY_NAME || name === selfName) continue;
    if (entity.parentRef !== undefined || entity.readGate !== undefined) continue;
    if (entity.idType !== undefined && entity.idType !== "uuid") continue;
    if (option.canReadEntity?.(name) !== true) continue;
    const fileFields = Object.entries(entity.fields)
      .filter(([, field]) => isFileField(field))
      .map(([fieldName]) => fieldName);
    if (fileFields.length === 0) continue;
    owners.push({
      name,
      entity,
      table: projectionTable ?? tableOf(option, name, entity),
      fileFields,
    });
  }
  return owners;
}

function ownerBranch(
  input: GateInput,
  owner: OwnerCandidate,
  refTable: Table,
  sql: GateSql,
): string | undefined {
  const { user, db } = input;
  const ownerTable = owner.table;
  const ownerTableName = String(schemaTableName(ownerTable));
  const ownership = buildOwnershipClause(
    user,
    owner.entity.access?.read,
    ownerTable,
    1,
    ownerTableName,
  );
  if (ownership.kind === "empty") return undefined;

  const readableAnywhere: string[] = [];
  const fieldArms: Array<{ field: string; clause: OwnershipClause }> = [];
  for (const field of owner.fileFields) {
    const fieldRead = buildOwnershipClause(
      user,
      normalizeAccessEntry(owner.entity.fields[field]?.access?.read),
      ownerTable,
      1,
      ownerTableName,
    );
    if (fieldRead.kind === "empty") continue;
    if (fieldRead.kind === "pass") readableAnywhere.push(field);
    else fieldArms.push({ field, clause: fieldRead });
  }
  if (readableAnywhere.length === 0 && fieldArms.length === 0) return undefined;

  const typeSql = `"${FILE_ALIAS}"."${physicalColumnName(refTable, "entityType")}" = ${sql.bind(owner.name)}`;
  const fieldCol = `"${FILE_ALIAS}"."${physicalColumnName(refTable, "fieldName")}"`;
  const idCol = `"${FILE_ALIAS}"."${physicalColumnName(refTable, "entityId")}"`;
  const uuidPattern = sql.bind(UUID_SHAPE_PATTERN);

  const arms: string[] = [];
  if (readableAnywhere.length > 0) {
    arms.push(`${fieldCol} IN (${readableAnywhere.map((f) => sql.bind(f)).join(", ")})`);
  }
  for (const arm of fieldArms) {
    if (arm.clause.kind !== "sql") continue;
    arms.push(`(${fieldCol} = ${sql.bind(arm.field)} AND ${sql.embed(arm.clause)})`);
  }
  const conditions = [
    `"${ownerTableName}"."${physicalColumnName(ownerTable, "id")}" = (CASE WHEN ${idCol} ~ ${uuidPattern} THEN ${idCol} END)::uuid`,
    ...tenantScopeSql(sql, db, ownerTable, ownerTableName),
    ...liveRowSql(owner.entity, ownerTable, ownerTableName),
  ];
  if (ownership.kind === "sql") conditions.push(sql.embed(ownership));
  conditions.push(`(${arms.join(" OR ")})`);
  return `(${typeSql} AND EXISTS (SELECT 1 FROM "${ownerTableName}" WHERE ${conditions.join(" AND ")}))`;
}

function fileOwnerClause(input: GateInput, field: string): OwnershipClause {
  const { option, db, tableName, table, entity } = input;
  const refEntity = option.entities.get(FILE_REF_ENTITY_NAME);
  if (refEntity === undefined) return EMPTY;
  const refTable = tableOf(option, FILE_REF_ENTITY_NAME, refEntity);
  const refTableName = String(schemaTableName(refTable));
  // The registry holds a spread copy of the entity, so the table name is the stable identity.
  const selfName = [...option.entities].find(
    ([, candidate]) => candidate.table === entity.table,
  )?.[0];

  const sql = new GateSql();
  const branches: string[] = [];
  if (selfName !== undefined) {
    const selfType = sql.bind(selfName);
    branches.push(
      `("${FILE_ALIAS}"."${physicalColumnName(refTable, "entityType")}" = ${selfType} AND "${FILE_ALIAS}"."${physicalColumnName(refTable, "entityId")}" = "${tableName}"."${physicalColumnName(table, "id")}"::text)`,
    );
  }
  for (const owner of ownerCandidates(input, selfName)) {
    const branch = ownerBranch(input, owner, refTable, sql);
    if (branch !== undefined) branches.push(branch);
  }
  if (branches.length === 0) return EMPTY;

  const conditions = [
    `"${FILE_ALIAS}"."${physicalColumnName(refTable, "id")}" = "${tableName}"."${physicalColumnName(table, field)}"`,
    ...tenantScopeSql(sql, db, refTable, FILE_ALIAS),
    ...liveRowSql(refEntity, refTable, FILE_ALIAS),
    `(${branches.join(" OR ")})`,
  ];
  return {
    kind: "sql",
    sqlText: `EXISTS (SELECT 1 FROM "${refTableName}" AS "${FILE_ALIAS}" WHERE ${conditions.join(" AND ")})`,
    params: sql.params,
  };
}

// Without the registry the gate cannot be resolved; every caller but the framework system user
// is denied, which is what forces hand-written handlers to wire parentVisibility.
export function buildReadGateClause(
  entity: EntityDefinition,
  table: Table,
  tableName: string,
  user: SessionUser,
  db: TenantDb,
  option: ParentVisibilityOption | undefined,
): OwnershipClause {
  const gate = entity.readGate;
  if (gate === undefined || isFrameworkSystemUser(user)) return PASS;
  if (option === undefined) return EMPTY;
  const input: GateInput = { entity, table, tableName, user, db, option };

  let clause: OwnershipClause = PASS;
  if (!isRoleExempt(gate, user)) {
    if (gate.anyLink !== undefined) {
      clause = combineClauses(clause, linkClause(input, gate.anyLink, "any"));
    }
    if (gate.allLinks !== undefined) {
      clause = combineClauses(clause, linkClause(input, gate.allLinks, "all"));
    }
  }
  if (gate.fileOwner !== undefined) {
    clause = combineClauses(clause, fileOwnerClause(input, gate.fileOwner.field));
  }
  return clause;
}

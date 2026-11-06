import type { ParentVisibilityOption } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { buildOwnershipClause, type OwnershipClause } from "../engine/ownership.ts";
import { SYSTEM_TENANT_ID, UUID_SHAPE_PATTERN } from "../engine/types/identifiers.ts";
import type { SessionUser } from "../engine/types/index.ts";

import type { Table } from "./event-store-executor-context.ts";
import { buildEntityTable, physicalColumnName } from "./table-builder.ts";
import { asEntityTableMeta, schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";
import { isGlobalTenancyTable } from "./tenant-db-runner.ts";

export type { ParentVisibilityOption } from "@cosmicdrift/kumiko-types/event-store-executor-types";

// Static, per-candidate SQL fragments (table name + physical column names) —
// derived from the entity definition alone, so they're the same on every
// request. buildEntityTable is too expensive to redo per request per
// candidate, hence the cache keyed by the entity object itself.
type CandidateStatics = {
  readonly table: Table;
  readonly tableName: string;
  readonly tenantIdCol: string | undefined;
  readonly isDeletedCol: string | undefined;
};

const candidateStaticsCache = new WeakMap<EntityDefinition, CandidateStatics>();

function candidateStaticsFor(
  candidateName: string,
  candidate: EntityDefinition,
  resolveTable: ParentVisibilityOption["resolveTable"],
): CandidateStatics {
  if (resolveTable !== undefined) return staticsOf(resolveTable(candidateName));
  const cached = candidateStaticsCache.get(candidate);
  if (cached) return cached;
  const statics = staticsOf(buildEntityTable(candidateName, candidate));
  candidateStaticsCache.set(candidate, statics);
  return statics;
}

function staticsOf(table: Table): CandidateStatics {
  const tableName = String(schemaTableName(table));
  return {
    table,
    tableName,
    tenantIdCol:
      table["tenantId"] !== undefined ? physicalColumnName(table, "tenantId") : undefined,
    isDeletedCol:
      table["isDeleted"] !== undefined ? physicalColumnName(table, "isDeleted") : undefined,
  };
}

// Candidate order follows `option.entities` (Registry insertion order) —
// deterministic given a fixed feature-registration order.
function selectCandidates(
  parentRef: NonNullable<EntityDefinition["parentRef"]>,
  option: ParentVisibilityOption,
  narrowTypes: ReadonlySet<string> | undefined,
  requireReadHandler: boolean,
): ReadonlyArray<readonly [string, EntityDefinition]> {
  const candidates: Array<readonly [string, EntityDefinition]> = [];
  for (const [name, candidate] of option.entities) {
    if (parentRef.allowedTypes && !parentRef.allowedTypes.includes(name)) continue;
    if (narrowTypes && !narrowTypes.has(name)) continue;
    // No recursive gating — a host that is itself a join-row entity would
    // need its own visibility resolved first, which this function doesn't do.
    if (candidate.parentRef !== undefined) continue;
    // A readGate host would need its own gate resolved first; unreadable beats a widened read.
    if (candidate.readGate !== undefined) continue;
    if (requireReadHandler && option.canReadEntity?.(name) !== true) continue;
    // event-store-executor-context.ts rejects non-uuid idType at executor
    // build time, so there is no read path to check such a candidate against.
    if (candidate.idType !== undefined && candidate.idType !== "uuid") continue;
    candidates.push([name, candidate]);
  }
  return candidates;
}

type ParentRefGateOptions = {
  readonly includeDeleted?: boolean;
  readonly narrowTypes?: ReadonlySet<string>;
  readonly requireReadHandler?: boolean;
};

// "statement": the clause the caller embeds; a global host it cannot see under the tenant scope
// counts only through `option.globalHostIds`. "globalHostsOnly": the global hosts' EXISTS arms,
// for the system-scope statement that resolves those ids (parent-ref-global-hosts.ts).
export type ParentRefGateMode = "statement" | "globalHostsOnly";

export function buildParentRefClause(
  entity: EntityDefinition,
  table: Table,
  tableName: string,
  user: SessionUser,
  db: TenantDb,
  option: ParentVisibilityOption | undefined,
  opts: ParentRefGateOptions,
): OwnershipClause {
  return buildParentRefGate(entity, table, tableName, user, db, option, opts, "statement");
}

// A tenant-scoped statement reads a global host table under row level security, which hides the
// system tenant rows a global host lives on; a join table that is global itself runs in the system scope.
export function readsGlobalHostsUnderTenantScope(db: TenantDb, joinTable: Table): boolean {
  return db.mode === "tenant" && !isGlobalTenancyTable(joinTable);
}

export function buildParentRefGate(
  entity: EntityDefinition,
  table: Table,
  tableName: string,
  user: SessionUser,
  db: TenantDb,
  option: ParentVisibilityOption | undefined,
  opts: ParentRefGateOptions,
  mode: ParentRefGateMode,
): OwnershipClause {
  const parentRef = entity.parentRef;
  if (parentRef === undefined) return { kind: "pass" };
  // The raw executor stays ungated when no registry is available — the
  // fail-closed guarantee for client-reachable paths comes from the boot
  // guard (validateParentRefs), not from throwing here. Throwing would 500
  // every existing custom handler and framework-internal detail() call that
  // doesn't pass parentVisibility.
  if (option === undefined) return { kind: "pass" };

  if (
    entity.fields[parentRef.entityTypeField] === undefined ||
    entity.fields[parentRef.entityIdField] === undefined
  ) {
    // Misconfigured parentRef — fail closed here; the boot guard catches
    // this earlier for any entity the registry actually validates.
    return { kind: "empty" };
  }
  const typeCol = physicalColumnName(table, parentRef.entityTypeField);
  const idCol = physicalColumnName(table, parentRef.entityIdField);

  const candidates = selectCandidates(
    parentRef,
    option,
    opts.narrowTypes,
    opts.requireReadHandler === true,
  );
  if (candidates.length === 0) return { kind: "empty" };

  const { branches, params } = collectGateBranches(candidates, mode, {
    db,
    user,
    option,
    joinTableName: tableName,
    typeCol,
    idCol,
    includeDeleted: opts.includeDeleted === true,
    globalHostsHidden: readsGlobalHostsUnderTenantScope(db, table),
  });
  if (branches.length === 0) return { kind: "empty" };
  return { kind: "sql", sqlText: `(${branches.join(" OR ")})`, params };
}

type GateBranchInputs = {
  readonly db: TenantDb;
  readonly user: SessionUser;
  readonly option: ParentVisibilityOption;
  readonly joinTableName: string;
  readonly typeCol: string;
  readonly idCol: string;
  readonly includeDeleted: boolean;
  readonly globalHostsHidden: boolean;
};

function collectGateBranches(
  candidates: ReturnType<typeof selectCandidates>,
  mode: ParentRefGateMode,
  gate: GateBranchInputs,
): { readonly branches: readonly string[]; readonly params: readonly unknown[] } {
  // The uuid shape and the tenant ids are bound once, together with the first kept
  // EXISTS branch, and shared by every later one: Postgres rejects a statement with
  // a parameter it cannot type, which an unused one is. The shape is a parameter
  // rather than a literal because shiftParams rewrites `$<digits>` anywhere in the
  // text, including inside a string.
  const params: unknown[] = [];
  let shared: SharedBinding | undefined;
  const branches: string[] = [];
  for (const [candidateName, candidate] of candidates) {
    const isHiddenGlobalHost =
      gate.globalHostsHidden &&
      candidate.tenancy === "global" &&
      !tableReadsSystemRows(
        candidateStaticsFor(candidateName, candidate, gate.option.resolveTable),
      );
    if (mode === "globalHostsOnly" && !isHiddenGlobalHost) continue;
    if (mode === "globalHostsOnly" && hostReadRuleNeedsRowLevelSecurity(candidate, gate.user)) {
      continue;
    }
    const resolvesHostIds = mode === "statement" && isHiddenGlobalHost;
    const pendingShared =
      resolvesHostIds || shared !== undefined
        ? undefined
        : planSharedBinding(gate.db, params.length);
    const binding = pendingShared ?? shared;
    const branchContext: BranchContext = {
      joinTableName: gate.joinTableName,
      typeCol: gate.typeCol,
      idCol: gate.idCol,
      uuidIdx: binding?.uuidIdx ?? 0,
      tenantIdx: binding?.tenantIdx,
      includeDeleted: gate.includeDeleted,
      // Ownership params are laid out right after the branch's own host-type
      // placeholder. Nothing reaches the shared `params` until the branch is
      // kept, so a dropped branch reserves no index and can't shift the
      // positional binding of the branches after it.
      typeParamIdx: params.length + (pendingShared?.values.length ?? 0) + 1,
      resolveTable: gate.option.resolveTable,
    };
    const branch = resolvesHostIds
      ? buildResolvedHostBranch(gate.option.globalHostIds?.get(candidateName), branchContext)
      : buildCandidateBranch(candidateName, candidate, gate.user, branchContext);
    if (branch === undefined) continue;
    if (pendingShared !== undefined) {
      params.push(...pendingShared.values);
      shared = pendingShared;
    }
    params.push(candidateName, ...branch.params);
    branches.push(branch.sqlText);
  }

  return { branches, params };
}

// The registry table carries the flag for implicitly classified reference data too, which the
// entity definition alone does not say; such a host is visible to the tenant-scoped EXISTS arm.
function tableReadsSystemRows(statics: CandidateStatics): boolean {
  return asEntityTableMeta(statics.table)?.systemRowsReadable === true;
}

// The system-scope host check has no row level security as a second layer, so a where-rule
// subquery over a tenant table would see other tenants' rows; such a host opens no arm (fail closed).
function hostReadRuleNeedsRowLevelSecurity(
  candidate: EntityDefinition,
  user: SessionUser,
): boolean {
  const readRules = candidate.access?.read;
  if (readRules === undefined) return false;
  const applicable = user.roles.flatMap((role) => {
    const rule = readRules[role];
    return rule === undefined ? [] : [rule];
  });
  return (
    !applicable.includes("all") &&
    applicable.some((rule) => rule !== "all" && rule.kind === "where")
  );
}

type SharedBinding = {
  readonly values: readonly unknown[];
  readonly uuidIdx: number;
  readonly tenantIdx: readonly [number, number] | undefined;
};

function planSharedBinding(db: TenantDb, boundSoFar: number): SharedBinding {
  if (db.mode !== "tenant") {
    return { values: [UUID_SHAPE_PATTERN], uuidIdx: boundSoFar + 1, tenantIdx: undefined };
  }
  return {
    values: [UUID_SHAPE_PATTERN, db.tenantId, SYSTEM_TENANT_ID],
    uuidIdx: boundSoFar + 1,
    tenantIdx: [boundSoFar + 2, boundSoFar + 3],
  };
}

// Unresolved ids leave the arm out: a host the statement cannot check is never treated as readable.
function buildResolvedHostBranch(
  hostIds: readonly string[] | undefined,
  ctx: BranchContext,
): { readonly sqlText: string; readonly params: readonly unknown[] } | undefined {
  if (hostIds === undefined || hostIds.length === 0) return undefined;
  return {
    sqlText: `("${ctx.joinTableName}"."${ctx.typeCol}" = $${ctx.typeParamIdx} AND "${ctx.joinTableName}"."${ctx.idCol}"::text = ANY($${ctx.typeParamIdx + 1}::text[]))`,
    params: [hostIds],
  };
}

type BranchContext = {
  readonly joinTableName: string;
  readonly typeCol: string;
  readonly idCol: string;
  readonly uuidIdx: number;
  readonly tenantIdx: readonly [number, number] | undefined;
  readonly includeDeleted: boolean;
  readonly typeParamIdx: number;
  readonly resolveTable: ParentVisibilityOption["resolveTable"];
};

// One `entity_type = $n AND EXISTS (...)` arm, or undefined when the host's own
// read ownership can never match — an unsatisfiable arm is dropped rather than
// emitted, which is what keeps an unreadable host from widening the OR-chain.
function buildCandidateBranch(
  candidateName: string,
  candidate: EntityDefinition,
  user: SessionUser,
  ctx: BranchContext,
): { readonly sqlText: string; readonly params: readonly unknown[] } | undefined {
  const statics = candidateStaticsFor(candidateName, candidate, ctx.resolveTable);
  const ownership = buildOwnershipClause(
    user,
    candidate.access?.read,
    statics.table,
    ctx.typeParamIdx + 1,
  );
  if (ownership.kind === "empty") return undefined;

  const hostId = `"${ctx.joinTableName}"."${ctx.idCol}"`;
  // CASE, not a bare cast: an id shaped for another host entity would abort the
  // whole statement with 22P02, and AND does not guarantee evaluation order.
  const conditions: string[] = [
    `"${statics.tableName}"."id" = (CASE WHEN ${hostId} ~ $${ctx.uuidIdx} THEN ${hostId} END)::uuid`,
  ];
  if (statics.tenantIdCol !== undefined && ctx.tenantIdx !== undefined) {
    conditions.push(
      `"${statics.tableName}"."${statics.tenantIdCol}" IN ($${ctx.tenantIdx[0]}, $${ctx.tenantIdx[1]})`,
    );
  }
  if (candidate.softDelete === true && statics.isDeletedCol !== undefined && !ctx.includeDeleted) {
    conditions.push(`"${statics.tableName}"."${statics.isDeletedCol}" = FALSE`);
  }
  if (ownership.kind === "sql") conditions.push(ownership.sqlText);

  return {
    sqlText: `("${ctx.joinTableName}"."${ctx.typeCol}" = $${ctx.typeParamIdx} AND EXISTS (SELECT 1 FROM "${statics.tableName}" WHERE ${conditions.join(" AND ")}))`,
    params: ownership.kind === "sql" ? ownership.params : [],
  };
}

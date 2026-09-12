import type { ParentVisibilityOption } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import { KUMIKO_NAME_SYMBOL } from "@cosmicdrift/kumiko-types/schema-table-types";
import { buildOwnershipClause, type OwnershipClause } from "../engine/ownership";
import type { EntityDefinition, SessionUser } from "../engine/types";
import { SYSTEM_TENANT_ID, UUID_SHAPE_PATTERN } from "../engine/types/identifiers";
import type { Table } from "./event-store-executor-context";
import { buildEntityTable, physicalColumnName } from "./table-builder";
import type { TenantDb } from "./tenant-db";

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

function candidateStaticsFor(candidateName: string, candidate: EntityDefinition): CandidateStatics {
  const cached = candidateStaticsCache.get(candidate);
  if (cached) return cached;
  const table = buildEntityTable(candidateName, candidate);
  const tableName = String((table as unknown as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL]);
  const statics: CandidateStatics = {
    table,
    tableName,
    tenantIdCol:
      table["tenantId"] !== undefined ? physicalColumnName(table, "tenantId") : undefined,
    isDeletedCol:
      table["isDeleted"] !== undefined ? physicalColumnName(table, "isDeleted") : undefined,
  };
  candidateStaticsCache.set(candidate, statics);
  return statics;
}

// Candidate order follows `option.entities` (Registry insertion order) —
// deterministic given a fixed feature-registration order.
function selectCandidates(
  parentRef: NonNullable<EntityDefinition["parentRef"]>,
  option: ParentVisibilityOption,
  narrowTypes: ReadonlySet<string> | undefined,
): ReadonlyArray<readonly [string, EntityDefinition]> {
  const candidates: Array<readonly [string, EntityDefinition]> = [];
  for (const [name, candidate] of option.entities) {
    if (parentRef.allowedTypes && !parentRef.allowedTypes.includes(name)) continue;
    if (narrowTypes && !narrowTypes.has(name)) continue;
    // No recursive gating — a host that is itself a join-row entity would
    // need its own visibility resolved first, which this function doesn't do.
    if (candidate.parentRef !== undefined) continue;
    // event-store-executor-context.ts rejects non-uuid idType at executor
    // build time, so there is no read path to check such a candidate against.
    if (candidate.idType !== undefined && candidate.idType !== "uuid") continue;
    candidates.push([name, candidate]);
  }
  return candidates;
}

export function buildParentRefClause(
  entity: EntityDefinition,
  table: Table,
  tableName: string,
  user: SessionUser,
  db: TenantDb,
  option: ParentVisibilityOption | undefined,
  opts: {
    readonly includeDeleted?: boolean;
    readonly narrowTypes?: ReadonlySet<string>;
  },
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

  const candidates = selectCandidates(parentRef, option, opts.narrowTypes);
  if (candidates.length === 0) return { kind: "empty" };

  // The uuid shape and the tenant ids are bound once and shared by every
  // branch. The shape is a parameter rather than a literal because shiftParams
  // rewrites `$<digits>` anywhere in the text, including inside a string.
  const params: unknown[] = [UUID_SHAPE_PATTERN];
  const uuidIdx = params.length;
  let tenantIdx: readonly [number, number] | undefined;
  if (db.mode === "tenant") {
    params.push(db.tenantId, SYSTEM_TENANT_ID);
    tenantIdx = [params.length - 1, params.length];
  }

  const branches: string[] = [];
  for (const [candidateName, candidate] of candidates) {
    const branch = buildCandidateBranch(candidateName, candidate, user, {
      joinTableName: tableName,
      typeCol,
      idCol,
      uuidIdx,
      tenantIdx,
      includeDeleted: opts.includeDeleted === true,
      // Ownership params are laid out right after the branch's own host-type
      // placeholder. Nothing reaches the shared `params` until the branch is
      // kept, so a dropped branch reserves no index and can't shift the
      // positional binding of the branches after it.
      typeParamIdx: params.length + 1,
    });
    if (branch === undefined) continue;
    params.push(candidateName, ...branch.params);
    branches.push(branch.sqlText);
  }

  if (branches.length === 0) return { kind: "empty" };
  return { kind: "sql", sqlText: `(${branches.join(" OR ")})`, params };
}

type BranchContext = {
  readonly joinTableName: string;
  readonly typeCol: string;
  readonly idCol: string;
  readonly uuidIdx: number;
  readonly tenantIdx: readonly [number, number] | undefined;
  readonly includeDeleted: boolean;
  readonly typeParamIdx: number;
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
  const statics = candidateStaticsFor(candidateName, candidate);
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

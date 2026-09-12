import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/factories";
import { combineClauses, from } from "../../engine/ownership";
import type { EntityDefinition, SessionUser } from "../../engine/types";
import { buildParentRefClause } from "../parent-ref-clause";
import { buildEntityTable } from "../table-builder";
import type { TenantDb } from "../tenant-db";

const TENANT = "11111111-1111-4111-8111-111111111111";

const user: SessionUser = {
  id: "22222222-2222-4222-8222-222222222222",
  tenantId: TENANT,
  roles: ["TenantMember"],
  claims: {},
};

// Only `mode` and `tenantId` are read by the clause builder.
const tenantDb = { mode: "tenant", tenantId: TENANT } as unknown as TenantDb;
const systemDb = { mode: "system", tenantId: TENANT } as unknown as TenantDb;

const textField = () =>
  createTextField({
    required: true,
    maxLength: 64,
    personal: false,
    reason: "technical_reference",
  });

const joinEntity = createEntity({
  table: "read_test_joins",
  fields: { entityType: textField(), entityId: textField() },
  parentRef: { entityTypeField: "entityType", entityIdField: "entityId" },
});

function hostEntity(opts?: {
  readonly access?: EntityDefinition["access"];
  readonly softDelete?: boolean;
  readonly idType?: "serial" | "uuid";
  readonly parentRef?: EntityDefinition["parentRef"];
}) {
  return createEntity({
    table: "read_test_hosts",
    fields: { ownerId: textField(), entityType: textField(), entityId: textField() },
    ...opts,
  });
}

const joinTable = buildEntityTable("test-join", joinEntity);

function build(
  entities: ReadonlyMap<string, EntityDefinition> | undefined,
  opts: { includeDeleted?: boolean; narrowTypes?: ReadonlySet<string>; db?: TenantDb } = {},
) {
  return buildParentRefClause(
    joinEntity,
    joinTable,
    "read_test_joins",
    user,
    opts.db ?? tenantDb,
    entities === undefined ? undefined : { entities },
    {
      ...(opts.includeDeleted !== undefined && { includeDeleted: opts.includeDeleted }),
      ...(opts.narrowTypes !== undefined && { narrowTypes: opts.narrowTypes }),
    },
  );
}

describe("buildParentRefClause", () => {
  test("an entity without parentRef is not gated", () => {
    const plain = createEntity({ table: "read_plain", fields: { a: textField() } });
    const clause = buildParentRefClause(
      plain,
      buildEntityTable("plain", plain),
      "read_plain",
      user,
      tenantDb,
      { entities: new Map([["host", hostEntity()]]) },
      {},
    );
    expect(clause.kind).toBe("pass");
  });

  test("a raw executor call without the registry option stays ungated", () => {
    expect(build(undefined).kind).toBe("pass");
  });

  test("no candidate at all denies every row", () => {
    expect(build(new Map()).kind).toBe("empty");
  });

  test("a candidate whose read-ownership can never match is dropped, denying when it was the only one", () => {
    // The role has a rule, but the column it names is not on the host — the
    // ownership clause collapses to `empty`, so the branch cannot be satisfied.
    const host = hostEntity({ access: { read: { TenantMember: from("user:id", "notAColumn") } } });
    expect(build(new Map([["host", host]])).kind).toBe("empty");
  });

  test("a serial-id candidate is excluded — it has no event-store read path", () => {
    const host = hostEntity({ idType: "serial" });
    expect(build(new Map([["host", host]])).kind).toBe("empty");
  });

  test("a candidate that is itself a join row is excluded — no recursive gating", () => {
    const host = hostEntity({
      parentRef: { entityTypeField: "entityType", entityIdField: "entityId" },
    });
    expect(build(new Map([["host", host]])).kind).toBe("empty");
  });

  test("narrowTypes restricts the OR-chain to the named hosts", () => {
    const entities = new Map([
      ["host", hostEntity()],
      ["other", hostEntity()],
      ["third", hostEntity()],
    ]);
    const all = build(entities);
    const narrowed = build(entities, { narrowTypes: new Set(["other"]) });
    if (all.kind !== "sql" || narrowed.kind !== "sql") throw new Error("expected sql clauses");
    expect(all.sqlText.split(" OR ")).toHaveLength(3);
    expect(narrowed.sqlText.split(" OR ")).toHaveLength(1);
    expect(narrowed.params).toContain("other");
    expect(narrowed.params).not.toContain("host");
  });

  test("the host's soft-delete filter applies by default and lifts under includeDeleted", () => {
    const entities = new Map([["host", hostEntity({ softDelete: true })]]);
    const gated = build(entities);
    const trash = build(entities, { includeDeleted: true });
    if (gated.kind !== "sql" || trash.kind !== "sql") throw new Error("expected sql clauses");
    expect(gated.sqlText).toContain('"is_deleted" = FALSE');
    expect(trash.sqlText).not.toContain("is_deleted");
  });

  test("the host id is matched through a shape guard, so a foreign id form cannot raise 22P02", () => {
    const clause = build(new Map([["host", hostEntity()]]));
    if (clause.kind !== "sql") throw new Error("expected sql clause");
    expect(clause.sqlText).toContain("CASE WHEN");
    expect(clause.sqlText).toContain("::uuid");
    // The shape itself is bound, never inlined — a literal carrying `$` would
    // be rewritten by shiftParams when the clause is combined.
    expect(clause.params[0]).toBe("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    expect(clause.sqlText).not.toContain("[0-9a-f]");
  });

  test("the tenant predicate is bound once and reused across branches", () => {
    const entities = new Map([
      ["host", hostEntity()],
      ["other", hostEntity()],
    ]);
    const clause = build(entities);
    if (clause.kind !== "sql") throw new Error("expected sql clause");
    expect(clause.params.filter((p) => p === TENANT)).toHaveLength(1);
    // uuid shape + 2 tenant params + one host-name param per branch.
    expect(clause.params).toHaveLength(5);
  });

  test("a system-mode db drops the tenant predicate, mirroring list()", () => {
    const clause = build(new Map([["host", hostEntity()]]), { db: systemDb });
    if (clause.kind !== "sql") throw new Error("expected sql clause");
    expect(clause.sqlText).not.toContain("tenant_id");
    expect(clause.params).not.toContain(TENANT);
  });

  test("a dropped branch reserves no placeholder — every $N still binds its own value", () => {
    // First candidate collapses to `empty` (column missing on the host), so its
    // tentatively-reserved indices must not leave a gap for the second.
    const entities = new Map([
      [
        "dropped",
        hostEntity({ access: { read: { TenantMember: from("user:id", "notAColumn") } } }),
      ],
      ["kept", hostEntity({ access: { read: { TenantMember: from("user:id", "ownerId") } } })],
    ]);
    const clause = build(entities);
    if (clause.kind !== "sql") throw new Error("expected sql clause");

    const indices = [...clause.sqlText.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...indices)).toBeLessThanOrEqual(clause.params.length);
    expect(Math.min(...indices)).toBeGreaterThanOrEqual(1);

    // The kept branch's host-name param must sit at the placeholder the SQL
    // actually names for it, not one slot over.
    const keptSlot = clause.params.indexOf("kept") + 1;
    expect(keptSlot).toBeGreaterThan(0);
    expect(clause.sqlText).toContain(`"entity_type" = $${keptSlot}`);
    expect(clause.params).toContain(user.id);
    expect(clause.params).not.toContain("dropped");
  });
});

describe("combineClauses", () => {
  const sqlA = { kind: "sql", sqlText: '"a" = $1', params: ["av"] } as const;
  const sqlB = { kind: "sql", sqlText: '"b" = $1 OR "c" = $2', params: ["bv", "cv"] } as const;

  test("empty on either side denies", () => {
    expect(combineClauses({ kind: "empty" }, sqlA).kind).toBe("empty");
    expect(combineClauses(sqlA, { kind: "empty" }).kind).toBe("empty");
  });

  test("pass is neutral", () => {
    expect(combineClauses({ kind: "pass" }, sqlA)).toEqual(sqlA);
    expect(combineClauses(sqlA, { kind: "pass" })).toEqual(sqlA);
    expect(combineClauses({ kind: "pass" }, { kind: "pass" }).kind).toBe("pass");
  });

  test("the second clause's placeholders are shifted past the first's params", () => {
    const combined = combineClauses(sqlA, sqlB);
    if (combined.kind !== "sql") throw new Error("expected sql clause");
    expect(combined.sqlText).toBe('("a" = $1 AND "b" = $2 OR "c" = $3)');
    expect(combined.params).toEqual(["av", "bv", "cv"]);
  });
});

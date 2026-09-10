// fw#2626 — boot guard: `{ kind: "where" }` is admissible on access.read
// (buildOwnershipClause runs it as SQL) and rejected on access.write, where
// rules are evaluated in memory against the concrete row and a create has no
// row at all. Without the guard such a map boots and only ever denies.

import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature";
import { createEntity, createTextField } from "../../factories";
import type { ClaimKeyDefinition, FeatureDefinition } from "../../types";
import type { OwnershipMap, WhereRule } from "../../types/ownership";
import { validateOwnershipRules } from "../ownership";

const NO_CLAIMS: ReadonlyMap<string, ClaimKeyDefinition> = new Map();
// Empty corpus keeps shouldValidateRoles() false, so role-existence checks
// stay out of the way of the where-rule assertions below.
const NO_ROLES: ReadonlySet<string> = new Set();

const ownerWhere: WhereRule = {
  kind: "where",
  where: (user, ctx) => ({
    sqlText: `${ctx.tableName}.owner_id = $${ctx.paramStart}`,
    params: [user.id],
  }),
};

type AccessMaps = { readonly read?: OwnershipMap; readonly write?: OwnershipMap };

function featureWith(entityAccess: AccessMaps, fieldAccess?: AccessMaps): FeatureDefinition {
  return defineFeature("memos", (r) => {
    r.entity(
      "memo",
      createEntity({
        table: "fw2626_guard_memos",
        fields: {
          ownerId: createTextField({ required: true }),
          title: createTextField({ access: fieldAccess }),
        },
        access: entityAccess,
      }),
    );
  });
}

function validate(feature: FeatureDefinition): void {
  validateOwnershipRules(feature, NO_CLAIMS, NO_ROLES);
}

describe("validateOwnershipRules — where-rules on access.write", () => {
  test("entity.access.write with a where-rule fails the boot", () => {
    const feature = featureWith({ write: { Member: ownerWhere } });
    expect(() => validate(feature)).toThrow(/access\.write/);
    expect(() => validate(feature)).toThrow(/where/);
  });

  test("the error names the role, the feature and the from()-alternative", () => {
    const feature = featureWith({ write: { Member: ownerWhere } });
    let message = "";
    try {
      validate(feature);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('"Member"');
    expect(message).toContain('"memos"');
    expect(message).toContain("from(");
  });

  test("field.access.write with a where-rule fails the boot", () => {
    const feature = featureWith({}, { write: { Member: ownerWhere } });
    expect(() => validate(feature)).toThrow(/memo\.title\.access\.write/);
  });

  test("a where-rule on access.write is rejected even next to an 'all' role", () => {
    const feature = featureWith({ write: { Admin: "all", Member: ownerWhere } });
    expect(() => validate(feature)).toThrow(/access\.write/);
  });
});

describe("validateOwnershipRules — where-rules on access.read stay supported", () => {
  test("entity.access.read with a where-rule boots", () => {
    expect(() => validate(featureWith({ read: { Member: ownerWhere } }))).not.toThrow();
  });

  test("field.access.read with a where-rule boots", () => {
    expect(() => validate(featureWith({}, { read: { Member: ownerWhere } }))).not.toThrow();
  });
});

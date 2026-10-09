// fw#2626 — boot guard: `{ kind: "where" }` is admissible only on entity
// access.read (buildOwnershipClause runs it as SQL). access.write and
// field-level access.read are evaluated in memory against the concrete row, so
// a where-rule there boots and only ever denies; the guard fails the boot.

import { describe, expect, test } from "bun:test";
import { buildEntityTable } from "../../../db/table-builder.js";
import { defineFeature } from "../../define-feature.js";
import { createEmbeddedField, createEntity, createTextField } from "../../factories.js";
import { tableNameOf } from "../../ownership.js";
import type { ClaimKeyDefinition, FeatureDefinition } from "../../types/index.js";
import type { OwnershipMap, WhereRule } from "../../types/ownership.js";
import { validateOwnershipRules } from "../ownership.js";

const NO_CLAIMS: ReadonlyMap<string, ClaimKeyDefinition> = new Map();
// Empty corpus keeps canValidateRoles() false, so role-existence checks
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
          ownerId: createTextField({ required: true, personal: false, reason: "test_fixture" }),
          title: createTextField({ access: fieldAccess, personal: false, reason: "test_fixture" }),
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

describe("validateOwnershipRules — probe renders the rule with the runtime table name", () => {
  test("ctx.tableName matches the built table's name, not the entity name", () => {
    const seen: string[] = [];
    const recordingWhere: WhereRule = {
      kind: "where",
      where: (user, ctx) => {
        seen.push(ctx.tableName);
        return { sqlText: `${ctx.tableName}.owner_id = $${ctx.paramStart}`, params: [user.id] };
      },
    };
    const feature = defineFeature("memos", (r) => {
      r.entity(
        "user-mfa",
        createEntity({
          fields: {
            ownerId: createTextField({ required: true, personal: false, reason: "test_fixture" }),
          },
          access: { read: { Member: recordingWhere } },
        }),
      );
    });

    validate(feature);

    const entity = feature.entities?.["user-mfa"];
    if (entity === undefined) throw new Error("fixture entity missing");
    expect(seen).toEqual([tableNameOf(buildEntityTable("user-mfa", entity))]);
    expect(seen[0]).not.toBe("user-mfa");
  });
});

describe("validateOwnershipRules — where-rules on access.read", () => {
  test("entity.access.read with a where-rule boots", () => {
    expect(() => validate(featureWith({ read: { Member: ownerWhere } }))).not.toThrow();
  });

  test("field.access.read with a where-rule fails the boot", () => {
    const feature = featureWith({}, { read: { Member: ownerWhere } });
    expect(() => validate(feature)).toThrow(/memo\.title\.access\.read/);
    expect(() => validate(feature)).toThrow(/from\(/);
  });

  test("an embedded sub-field with a where-rule on access.read fails the boot", () => {
    const feature = defineFeature("memos", (r) => {
      r.entity(
        "memo",
        createEntity({
          fields: {
            detail: createEmbeddedField(
              {
                note: createTextField({
                  access: { read: { Member: ownerWhere } },
                  personal: false,
                  reason: "test_fixture",
                }),
              },
              { personal: false, reason: "test_fixture" },
            ),
          },
        }),
      );
    });
    expect(() => validate(feature)).toThrow(/memo\.detail\.note\.access\.read/);
  });
});

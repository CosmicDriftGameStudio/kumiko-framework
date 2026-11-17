import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { from } from "../../ownership.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  describe("ownership rules", () => {
    test("passes for entity.access.read with claim-rule whose QN exists", () => {
      const features = [
        defineFeature("teams", (r) => {
          r.claimKey({ name: "teamId", type: "string" });
        }),
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {
                teamId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
              },
              access: {
                read: { Admin: "all", TeamMember: from("claim:teams:teamId") },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("detects claim-QN that no feature declared", () => {
      const features = [
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {
                teamId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
              },
              access: {
                // No "teams" feature registered — claim doesn't exist.
                read: { TeamMember: from("claim:teams:teamId") },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /entity "order"\.access\.read.*references unknown claim "teams:teamId"/,
      );
    });

    test("detects column name that doesn't exist on the entity", () => {
      const features = [
        defineFeature("teams", (r) => {
          r.claimKey({ name: "teamId", type: "string" });
        }),
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {
                teamId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
              },
              access: {
                read: {
                  // column "nonExistentColumn" not on entity
                  TeamMember: from("claim:teams:teamId", "nonExistentColumn"),
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /references column "nonExistentColumn" which does not exist/,
      );
    });

    test("passes for field-level ownership rule with existing claim + column", () => {
      const features = [
        defineFeature("teams", (r) => {
          r.claimKey({ name: "teamId", type: "string" });
        }),
        defineFeature("contracts", (r) => {
          r.entity({
            name: "contract",
            ...createEntity({
              table: "contracts",
              fields: {
                teamId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
                propC: createTextField({
                  access: {
                    read: { Admin: "all", TeamMember: from("claim:teams:teamId") },
                    write: { Admin: "all", TeamMember: from("claim:teams:teamId") },
                  },
                  personal: false,
                  reason: "test_fixture",
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("detects unknown claim on field-level rule", () => {
      const features = [
        defineFeature("contracts", (r) => {
          r.entity({
            name: "contract",
            ...createEntity({
              table: "contracts",
              fields: {
                teamId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
                propC: createTextField({
                  access: {
                    // claim not declared anywhere
                    read: { TeamMember: from("claim:nowhere:teamId") },
                  },
                  personal: false,
                  reason: "test_fixture",
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /contract\.propC\.access\.read.*references unknown claim "nowhere:teamId"/,
      );
    });

    test("user-ref rule with valid column passes", () => {
      const features = [
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: { assigneeId: createTextField({ personal: false, reason: "test_fixture" }) },
              access: {
                read: { Driver: from("user:id", "assigneeId") },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("'all' rule and { where } rule bypass validation (no ref to check)", () => {
      const features = [
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: { assigneeId: createTextField({ personal: false, reason: "test_fixture" }) },
              access: {
                read: {
                  Admin: "all",
                  Auditor: {
                    kind: "where",
                    where: () => ({ queryChunks: [] }) as never,
                  },
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("a where-rule with an unqualified column inside a subquery fails boot", () => {
      const features = [
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {
                entityId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
              },
              access: {
                read: {
                  Auditor: {
                    kind: "where",
                    where: (_user, ctx) => ({
                      sqlText: `EXISTS (SELECT 1 FROM teams t WHERE t.entity_id = entity_id AND t.team_id = $${ctx.paramStart})`,
                      params: ["team-a"],
                    }),
                  },
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/unqualified/i);
    });

    test("the same where-rule, correctly qualified, passes boot", () => {
      const features = [
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {
                entityId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
              },
              access: {
                read: {
                  Auditor: {
                    kind: "where",
                    where: (_user, ctx) => ({
                      sqlText: `EXISTS (SELECT 1 FROM teams t WHERE t.entity_id = ${ctx.tableName}.entity_id AND t.team_id = $${ctx.paramStart})`,
                      params: ["team-a"],
                    }),
                  },
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("framework columns (id, tenantId, version, ...) are acceptable targets", () => {
      const features = [
        defineFeature("teams", (r) => {
          r.claimKey({ name: "teamId", type: "string" });
        }),
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {},
              access: {
                read: {
                  // tenantId is framework-managed — boot-validator should not reject
                  TeamMember: from("claim:teams:teamId", "tenantId"),
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    // --- Role-name validation ---

    test("detects role-name typo in OwnershipMap when other handlers declare the real role", () => {
      // One feature runs a handler that declares the real role "Admin"; a
      // second feature has a typo "Admi" in its OwnershipMap. Validator
      // sees "Admin" in the known-role corpus (from handler.access.roles)
      // and flags "Admi" as unknown.
      const features = [
        defineFeature("accounts", (r) => {
          r.writeHandler({
            name: "accounts:create",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
        }),
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {
                teamId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
              },
              access: {
                read: { Admi: "all" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /unknown role "Admi".*Known roles: Admin, all, system/,
      );
    });

    test("detects role-name typo in legacy string[] field-access", () => {
      const features = [
        defineFeature("accounts", (r) => {
          r.writeHandler({
            name: "accounts:create",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
        }),
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {
                secret: createTextField({
                  access: { read: ["Admni"] },
                  personal: false,
                  reason: "test_fixture",
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /order\.secret\.access\.read.*unknown role "Admni"/,
      );
    });

    test("passes when all OwnershipMap roles are referenced by handler access rules too", () => {
      const features = [
        defineFeature("accounts", (r) => {
          r.writeHandler({
            name: "accounts:create",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin", "TeamMember"] },
          });
        }),
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {
                teamId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
              },
              access: {
                read: { Admin: "all", TeamMember: "all" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("skips role validation entirely when no handlers declare non-builtin roles", () => {
      // Apps running only on openToAll / system handlers have no corpus
      // of known roles beyond "all"/"system" — validator must not flag
      // their OwnershipMap roles as unknown. This is the regression test
      // for the canValidateRoles gate.
      const features = [
        defineFeature("orders", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              table: "orders",
              fields: {
                teamId: createTextField({
                  required: true,
                  personal: false,
                  reason: "test_fixture",
                }),
              },
              access: {
                read: { AnyRole: "all" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });
  });

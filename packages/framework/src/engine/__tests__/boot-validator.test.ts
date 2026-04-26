import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { validateBoot } from "../boot-validator";
import { createSystemConfig, createTenantConfig } from "../config-helpers";
import {
  createEntity,
  createMultiSelectField,
  createTextField,
  defineFeature,
  from,
} from "../index";

describe("boot-validator", () => {
  test("passes for valid features with no issues", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity("user", createEntity({ table: "Users", fields: { name: createTextField() } }));
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  // --- Circular dependencies ---

  test("detects circular requires: A → B → A", () => {
    const features = [
      defineFeature("a", (r) => {
        r.requires("b");
      }),
      defineFeature("b", (r) => {
        r.requires("a");
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/circular dependency.*a.*b/i);
  });

  test("detects circular requires: A → B → C → A", () => {
    const features = [
      defineFeature("a", (r) => {
        r.requires("b");
      }),
      defineFeature("b", (r) => {
        r.requires("c");
      }),
      defineFeature("c", (r) => {
        r.requires("a");
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/circular dependency/i);
  });

  test("no circular dependency for diamond shape: A → B, A → C, B → D, C → D", () => {
    const features = [
      defineFeature("d", () => {}),
      defineFeature("b", (r) => {
        r.requires("d");
      }),
      defineFeature("c", (r) => {
        r.requires("d");
      }),
      defineFeature("a", (r) => {
        r.requires("b", "c");
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  // --- encrypted + searchable ---

  test("rejects encrypted + searchable field", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "secret",
          createEntity({
            table: "Secrets",
            fields: {
              apiKey: { type: "text", encrypted: true, searchable: true },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(
      /apiKey.*cannot be both encrypted and searchable/i,
    );
  });

  test("rejects encrypted + sortable field", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "secret",
          createEntity({
            table: "Secrets",
            fields: {
              token: { type: "text", encrypted: true, sortable: true },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/token.*cannot be both encrypted and sortable/i);
  });

  test("allows encrypted field when ENCRYPTION_KEY is set", () => {
    process.env["ENCRYPTION_KEY"] = "test-key";
    try {
      const features = [
        defineFeature("a", (r) => {
          r.entity(
            "secret",
            createEntity({
              table: "Secrets",
              fields: {
                apiKey: { type: "text", encrypted: true },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    } finally {
      delete process.env["ENCRYPTION_KEY"];
    }
  });

  test("throws when encrypted fields exist but ENCRYPTION_KEY not set", () => {
    delete process.env["ENCRYPTION_KEY"];
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "secret",
          createEntity({
            table: "Secrets",
            fields: {
              apiKey: { type: "text", encrypted: true },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/ENCRYPTION_KEY.*required/i);
  });

  // --- Extension usage without requires ---

  test("warns when extension used without requires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
      // Missing: r.requires("tags")
    });

    expect(() => validateBoot([ext, consumer])).toThrow(/fleet.*uses extension "tags".*requires/i);
  });

  test("passes when extension used with requires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.requires("tags");
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
    });

    expect(() => validateBoot([ext, consumer])).not.toThrow();
  });

  test("passes when extension used with optionalRequires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.optionalRequires("tags");
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
    });

    expect(() => validateBoot([ext, consumer])).not.toThrow();
  });

  // --- FILE_STORAGE_PROVIDER ---

  test("throws when file fields exist but FILE_STORAGE_PROVIDER not set", () => {
    delete process.env["FILE_STORAGE_PROVIDER"];
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "doc",
          createEntity({
            table: "Docs",
            fields: { contract: { type: "file" } },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/FILE_STORAGE_PROVIDER.*required/i);
  });

  test("passes when file fields exist and FILE_STORAGE_PROVIDER is set", () => {
    process.env["FILE_STORAGE_PROVIDER"] = "local";
    try {
      const features = [
        defineFeature("a", (r) => {
          r.entity(
            "doc",
            createEntity({
              table: "Docs",
              fields: { photo: { type: "image" } },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    } finally {
      delete process.env["FILE_STORAGE_PROVIDER"];
    }
  });

  // --- extendSchema column collision ---

  test("throws when extendSchema column conflicts with existing field", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "item",
          createEntity({
            table: "Items",
            fields: { name: createTextField() },
          }),
        );
        r.extendsRegistrar("custom", {
          extendSchema: () => ({ name: { type: "text" as const } }),
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(
      /extendSchema column "name" conflicts.*entity "item"/i,
    );
  });

  // --- Config key cross-feature references ---

  test("throws when readsConfig references non-existent key", () => {
    const features = [
      defineFeature("invoicing", (r) => {
        r.readsConfig("payments.gateway");
      }),
    ];
    expect(() => validateBoot(features)).toThrow(
      /invoicing.*reads config "payments.gateway".*no feature defines/i,
    );
  });

  test("passes when readsConfig references existing key", () => {
    const features = [
      defineFeature("payments", (r) => {
        r.config({
          keys: {
            gateway: {
              type: "text",
              scope: "tenant",
              access: { read: ["all"], write: ["Admin"] },
            },
          },
        });
      }),
      defineFeature("invoicing", (r) => {
        r.requires("payments");
        r.readsConfig("payments.gateway");
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("passes when extendSchema adds non-conflicting column", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "item",
          createEntity({
            table: "Items",
            fields: { name: createTextField() },
          }),
        );
        r.extendsRegistrar("custom", {
          extendSchema: () => ({ extra: { type: "text" as const } }),
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  // --- Handler access validation (default-deny) ---

  test("throws when a write handler has no access rule", () => {
    const features = [
      defineFeature("a", (r) => {
        r.writeHandler("createThing", z.object({ name: z.string() }), async () => ({
          isSuccess: true as const,
          data: {},
        }));
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/a:write:createThing.*missing an access rule/i);
  });

  test("throws when a query handler has no access rule", () => {
    const features = [
      defineFeature("a", (r) => {
        r.queryHandler("list", z.object({}), async () => []);
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/a:query:list.*missing an access rule/i);
  });

  test("accepts role-based access rule", () => {
    const features = [
      defineFeature("a", (r) => {
        r.queryHandler("list", z.object({}), async () => [], {
          access: { roles: ["Admin"] },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("accepts openToAll access rule", () => {
    const features = [
      defineFeature("a", (r) => {
        r.queryHandler("list", z.object({}), async () => [], {
          access: { openToAll: true },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  describe("config key bounds consistency", () => {
    test("accepts number key with consistent bounds + default", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              maxUploadMB: createTenantConfig("number", {
                default: 10,
                bounds: { min: 1, max: 100 },
              }),
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("rejects min > max", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              weird: createTenantConfig("number", { bounds: { min: 100, max: 10 } }),
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/bounds\.min.*>.*bounds\.max/i);
    });

    test("rejects default below min", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              tooLow: createTenantConfig("number", {
                default: 0,
                bounds: { min: 1, max: 100 },
              }),
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/default.*below bounds\.min/i);
    });

    test("rejects default above max", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              tooHigh: createSystemConfig("number", {
                default: 200,
                bounds: { max: 100 },
              }),
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/default.*above bounds\.max/i);
    });

    test("accepts partial bounds (only min)", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              lowerOnly: createTenantConfig("number", {
                default: 5,
                bounds: { min: 1 },
              }),
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("accepts bounds without default (bound-only key)", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              bounded: createTenantConfig("number", { bounds: { min: 1, max: 100 } }),
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("rejects bounds on non-number key (defence in depth against hand-rolled definitions)", () => {
      const features = [
        defineFeature("files", (r) => {
          // Cast needed because type-level guard rejects this at the call site.
          // Boot validator catches the same class of bug when someone bypasses
          // the helper (e.g. importing a plain ConfigKeyDefinition object).
          r.config({
            keys: {
              textKey: {
                type: "text",
                scope: "tenant",
                access: { read: ["all"], write: ["all"] },
                bounds: { min: 1 },
                // biome-ignore lint/suspicious/noExplicitAny: intentional type bypass for defence-in-depth test
              } as any,
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/bounds.*only valid for type="number"/i);
    });
  });

  describe("config key computed + encrypted exclusivity", () => {
    test("rejects encrypted + computed combination", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              mixed: {
                type: "text",
                scope: "tenant",
                access: { read: ["all"], write: ["all"] },
                encrypted: true,
                computed: async () => "x",
                // biome-ignore lint/suspicious/noExplicitAny: hand-rolled definition bypasses helper-level type narrowing
              } as any,
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/encrypted.*computed.*mutually exclusive/i);
    });

    test("accepts computed without encrypted (normal plan-based use-case)", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              planBased: createTenantConfig("number", {
                default: 10,
                computed: async () => 100,
              }),
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });
  });

  describe("config key allowPerRequest compatibility", () => {
    test("accepts allowPerRequest on number keys", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              maxSize: createTenantConfig("number", {
                default: 10,
                bounds: { min: 1, max: 1000 },
                allowPerRequest: true,
              }),
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("rejects allowPerRequest on text keys (hand-rolled bypass)", () => {
      const features = [
        defineFeature("files", (r) => {
          r.config({
            keys: {
              hacked: {
                type: "text",
                scope: "tenant",
                access: { read: ["all"], write: ["all"] },
                allowPerRequest: true,
                // biome-ignore lint/suspicious/noExplicitAny: defence-in-depth test for hand-rolled definitions
              } as any,
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/allowPerRequest.*type="text".*ineligible/i);
    });

    test("rejects allowPerRequest on encrypted keys (secret-value protection)", () => {
      const features = [
        defineFeature("secrets", (r) => {
          r.config({
            keys: {
              apiKey: {
                type: "number",
                scope: "tenant",
                access: { read: ["Admin"], write: ["Admin"] },
                encrypted: true,
                allowPerRequest: true,
                // biome-ignore lint/suspicious/noExplicitAny: defence-in-depth test for hand-rolled definitions
              } as any,
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /allowPerRequest.*encrypted.*secret values may not be set via query-params/i,
      );
    });
  });

  // --- H.2 Ownership-Rule validation ---

  describe("ownership rules (H.2)", () => {
    test("passes for entity.access.read with claim-rule whose QN exists", () => {
      const features = [
        defineFeature("teams", (r) => {
          r.claimKey("teamId", { type: "string" });
        }),
        defineFeature("orders", (r) => {
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: { teamId: createTextField({ required: true }) },
              access: {
                read: { Admin: "all", TeamMember: from("claim:teams:teamId") },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("detects claim-QN that no feature declared", () => {
      const features = [
        defineFeature("orders", (r) => {
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: { teamId: createTextField({ required: true }) },
              access: {
                // No "teams" feature registered — claim doesn't exist.
                read: { TeamMember: from("claim:teams:teamId") },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /entity "order"\.access\.read.*references unknown claim "teams:teamId"/,
      );
    });

    test("detects column name that doesn't exist on the entity", () => {
      const features = [
        defineFeature("teams", (r) => {
          r.claimKey("teamId", { type: "string" });
        }),
        defineFeature("orders", (r) => {
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: { teamId: createTextField({ required: true }) },
              access: {
                read: {
                  // column "nonExistentColumn" not on entity
                  TeamMember: from("claim:teams:teamId", "nonExistentColumn"),
                },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /references column "nonExistentColumn" which does not exist/,
      );
    });

    test("passes for field-level ownership rule with existing claim + column", () => {
      const features = [
        defineFeature("teams", (r) => {
          r.claimKey("teamId", { type: "string" });
        }),
        defineFeature("contracts", (r) => {
          r.entity(
            "contract",
            createEntity({
              table: "contracts",
              fields: {
                teamId: createTextField({ required: true }),
                propC: createTextField({
                  access: {
                    read: { Admin: "all", TeamMember: from("claim:teams:teamId") },
                    write: { Admin: "all", TeamMember: from("claim:teams:teamId") },
                  },
                }),
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("detects unknown claim on field-level rule", () => {
      const features = [
        defineFeature("contracts", (r) => {
          r.entity(
            "contract",
            createEntity({
              table: "contracts",
              fields: {
                teamId: createTextField({ required: true }),
                propC: createTextField({
                  access: {
                    // claim not declared anywhere
                    read: { TeamMember: from("claim:nowhere:teamId") },
                  },
                }),
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /contract\.propC\.access\.read.*references unknown claim "nowhere:teamId"/,
      );
    });

    test("user-ref rule with valid column passes", () => {
      const features = [
        defineFeature("orders", (r) => {
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: { assigneeId: createTextField() },
              access: {
                read: { Driver: from("user:id", "assigneeId") },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("'all' rule and { where } rule bypass validation (no ref to check)", () => {
      const features = [
        defineFeature("orders", (r) => {
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: { assigneeId: createTextField() },
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
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("framework columns (id, tenantId, version, ...) are acceptable targets", () => {
      const features = [
        defineFeature("teams", (r) => {
          r.claimKey("teamId", { type: "string" });
        }),
        defineFeature("orders", (r) => {
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: {},
              access: {
                read: {
                  // tenantId is framework-managed — boot-validator should not reject
                  TeamMember: from("claim:teams:teamId", "tenantId"),
                },
              },
            }),
          );
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
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: { teamId: createTextField({ required: true }) },
              access: {
                read: { Admi: "all" },
              },
            }),
          );
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
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: {
                secret: createTextField({ access: { read: ["Admni"] } }),
              },
            }),
          );
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
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: { teamId: createTextField({ required: true }) },
              access: {
                read: { Admin: "all", TeamMember: "all" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("skips role validation entirely when no handlers declare non-builtin roles", () => {
      // Apps running only on openToAll / system handlers have no corpus
      // of known roles beyond "all"/"system" — validator must not flag
      // their OwnershipMap roles as unknown. This is the regression test
      // for the shouldValidateRoles gate.
      const features = [
        defineFeature("orders", (r) => {
          r.entity(
            "order",
            createEntity({
              table: "orders",
              fields: { teamId: createTextField({ required: true }) },
              access: {
                read: { AnyRole: "all" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });
  });

  // --- MultiStreamProjection delivery invariant (Welle 2.7) ---

  describe("MultiStreamProjection delivery", () => {
    const sinkTable = pgTable("sink", { id: text("id").primaryKey() });

    test("rejects delivery='per-instance' combined with a backing table", () => {
      const features = [
        defineFeature("sse", (r) => {
          r.multiStreamProjection({
            name: "broadcast",
            table: sinkTable,
            delivery: "per-instance",
            apply: { "some:event": async () => {} },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /per-instance.+table.+duplicate INSERTs|cursor divergence/i,
      );
    });

    test("accepts delivery='per-instance' without a table (side-effect-only)", () => {
      const features = [
        defineFeature("sse", (r) => {
          r.multiStreamProjection({
            name: "broadcast",
            delivery: "per-instance",
            apply: { "some:event": async () => {} },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("accepts delivery='shared' with a table (default, materialized read-model)", () => {
      const features = [
        defineFeature("reports", (r) => {
          r.multiStreamProjection({
            name: "rollup",
            table: sinkTable,
            delivery: "shared",
            apply: { "some:event": async () => {} },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });
  });

  // --- MultiSelect-Field-Validation ---

  describe("multiSelect fields", () => {
    test("accepts multiSelect with non-empty options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity(
            "profile",
            createEntity({
              fields: {
                tags: createMultiSelectField({ options: ["a", "b", "c"] as const }),
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("rejects multiSelect with empty options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity(
            "profile",
            createEntity({
              fields: {
                // Cast over the empty-array hole — the factory's generic
                // `as const` widens to `readonly never[]` for `[]`, which
                // is what we want to test against. The validator catches
                // it at boot.
                tags: createMultiSelectField({ options: [] as readonly string[] }),
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/empty options/);
    });

    test("rejects default value not in options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity(
            "profile",
            createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
                  default: ["c"] as any,
                }),
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/not a valid option/);
    });

    test("accepts default that is a subset of options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity(
            "profile",
            createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b", "c"] as const,
                  default: ["a", "c"],
                }),
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });
  });

  // --- entityList column-renderer form-check ---
  // Validator akzeptiert die `{ react: { __component: "Name" } }`-Form
  // (PlatformComponent → client-side Registry-Lookup) und prüft sie
  // strukturell. String-Funktionen, null/undefined, native-only und
  // andere Formen bleiben opak.
  describe("entityList column renderer form", () => {
    function shopFeature(renderer: unknown) {
      return defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: { name: createTextField() } }));
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          // Renderer ist absichtlich unknown — die Validator-Tests pinnen
          // auch Formen die der TS-Compiler bei sauberer Hand-Schreibe
          // niemals zulassen würde (leerer __component, number etc.).
          // kumiko-lint-ignore as-cast renderer ist Test-Fixture für invalid forms
          columns: [{ field: "name", renderer: renderer as never }],
        });
      });
    }

    test("function-renderer → kein Throw (Bestand)", () => {
      expect(() => validateBoot([shopFeature((v: unknown) => String(v))])).not.toThrow();
    });

    test("undefined renderer → kein Throw (Spalte ohne Renderer)", () => {
      expect(() => validateBoot([shopFeature(undefined)])).not.toThrow();
    });

    test("null renderer → kein Throw (skip)", () => {
      expect(() => validateBoot([shopFeature(null)])).not.toThrow();
    });

    test("object ohne react-Branch → kein Throw (z.B. native-only)", () => {
      expect(() => validateBoot([shopFeature({ native: { __component: "X" } })])).not.toThrow();
    });

    test("react-Branch ist non-object → Throw mit klarer Message", () => {
      expect(() => validateBoot([shopFeature({ react: 42 })])).toThrow(/non-object `react` branch/);
    });

    test("react-Branch ohne __component-Schlüssel → kein Throw (skip)", () => {
      // {} oder { __component: undefined } sind nicht unsere String-Key-Form
      expect(() => validateBoot([shopFeature({ react: {} })])).not.toThrow();
    });

    test("react.__component leerer String → Throw", () => {
      expect(() => validateBoot([shopFeature({ react: { __component: "" } })])).toThrow(
        /expected a non-empty string/,
      );
    });

    test("react.__component non-String (number) → Throw", () => {
      expect(() => validateBoot([shopFeature({ react: { __component: 42 } })])).toThrow(
        /expected a non-empty string/,
      );
    });

    test("react.__component nicht-leerer String → kein Throw (gültige Form)", () => {
      expect(() =>
        validateBoot([shopFeature({ react: { __component: "ColorSwatch" } })]),
      ).not.toThrow();
    });
  });

  // --- entityList: pagination + sort validation ---
  // Author-Fehler vor Production fangen, damit "Screen lädt nichts /
  // sortiert falsch / crasht beim Pager-Klick" nicht erst zur Laufzeit
  // bemerkt wird. Die Tests pinnen nur server-side Validierungen —
  // UI-Verhalten (Pager-Rendering) ist Renderer-Sache.
  describe("entityList pagination + sort", () => {
    function makeFeature(
      override: Partial<{
        readonly pageSize: number;
        readonly defaultSort: { readonly field: string; readonly dir: "asc" | "desc" };
      }>,
    ) {
      return defineFeature("shop", (r) => {
        r.entity(
          "product",
          createEntity({
            fields: {
              name: createTextField({ sortable: true }),
              // Bewusst NICHT sortable: bestätigt dass Validator das
              // unterscheidet und nur sortable-Felder als defaultSort
              // akzeptiert.
              description: createTextField(),
            },
          }),
        );
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: [{ field: "name" }],
          ...override,
        });
      });
    }

    test("pageSize: positiv → kein Throw", () => {
      expect(() => validateBoot([makeFeature({ pageSize: 100 })])).not.toThrow();
    });

    test("pageSize: 0 → Throw mit klarer Message", () => {
      expect(() => validateBoot([makeFeature({ pageSize: 0 })])).toThrow(
        /pageSize=0 — must be a positive integer/,
      );
    });

    test("pageSize: negativ → Throw", () => {
      expect(() => validateBoot([makeFeature({ pageSize: -10 })])).toThrow(
        /pageSize=-10 — must be a positive integer/,
      );
    });

    test("defaultSort.field: existiert + sortable=true → kein Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ defaultSort: { field: "name", dir: "asc" } })]),
      ).not.toThrow();
    });

    test("defaultSort.field: existiert NICHT → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ defaultSort: { field: "ghost", dir: "asc" } })]),
      ).toThrow(/defaultSort references unknown field "ghost"/);
    });

    test("defaultSort.field: existiert aber sortable=false → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ defaultSort: { field: "description", dir: "asc" } })]),
      ).toThrow(/defaultSort\.field "description" is not sortable/);
    });
  });
});

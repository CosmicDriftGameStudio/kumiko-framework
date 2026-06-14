import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { SchemaTable } from "../../db/dialect";
import { table, text } from "../../db/dialect";
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

  test("throws when longText encrypted field exists but ENCRYPTION_KEY not set", () => {
    // Drift-pin Sprint-5b-vorab-Audit Issue 1: validateEncryptedFields
    // hatte `if (field.type !== "text") continue;` und ignorierte
    // longText-encrypted-fields silently — ENCRYPTION_KEY-check wurde
    // nie getriggert, encryption silent broken. Jetzt: beide string-
    // typed fields werden gechecked.
    delete process.env["ENCRYPTION_KEY"];
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "doc",
          createEntity({
            table: "Docs",
            fields: {
              body: { type: "longText", encrypted: true },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/ENCRYPTION_KEY.*required/i);
  });

  // --- index-validator longText block ---

  test("rejects longText field in entity.indexes (longText is not indexable)", () => {
    // Drift-pin Sprint-5b-vorab-Audit Issue 2: ohne den Check würde
    // ein BTREE-Index auf einer 1-MB-text-Spalte gebaut werden
    // (Performance-Disaster mit TOAST-page-Dereferenzierung). longText
    // ist semantisch non-indexierbar, konsistent zum type-level
    // sortable=false.
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "doc",
          createEntity({
            table: "Docs",
            fields: {
              body: { type: "longText" },
              title: { type: "text" },
            },
            indexes: [{ columns: ["title", "body"] }],
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/body.*longText.*cannot be indexed/i);
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

  test("passes when a feature provides AND uses its own extension (self-extension)", () => {
    // tier-engine pattern: a feature defines an extension-point and ships a
    // default plugin for it, so providerFeature === feature.name. Requiring
    // the feature to requires(self) would be circular — the validator must
    // skip the requires-check for self-provided extensions. The cross-feature
    // tests above only exercise providerFeature !== feature.name.
    const self = defineFeature("tier-stub", (r) => {
      r.extendsRegistrar("tenantTierResolver", { onRegister: () => {} });
      r.entity("dummy", createEntity({ table: "Dummies", fields: {} }));
      r.useExtension("tenantTierResolver", "dummy");
    });
    expect(() => validateBoot([self])).not.toThrow();
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
    const sinkTable = table("sink", { id: text("id").primaryKey() }) as unknown as SchemaTable;

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

  // --- Tier 2.7c: Screen-Filter ---
  // Drei Layer Author-Code-Validation: field-existiert, filterable: true
  // gesetzt, op passt zum Field-Type. Boot-Fail ist deutlich besser als
  // silent-leerer Bucket / Drizzle-Crash zur Laufzeit.
  describe("entityList screen-filter (Tier 2.7c)", () => {
    function makeFeature(
      filter: {
        readonly field: string;
        readonly op: "eq" | "ne" | "lt" | "gt" | "in";
        readonly value: unknown;
      },
      fields: Record<string, unknown> = {
        name: { type: "text", sortable: true, filterable: true },
        status: { type: "text", filterable: true },
        secret: { type: "text" },
      },
    ) {
      return defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: fields as never }));
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: [{ field: "name" }],
          filter,
        });
      });
    }

    test("filter.field existiert + filterable → kein Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ field: "status", op: "eq", value: "active" })]),
      ).not.toThrow();
    });

    test("filter.field existiert NICHT → Throw mit klarer Message", () => {
      expect(() => validateBoot([makeFeature({ field: "ghost", op: "eq", value: "x" })])).toThrow(
        /filter references unknown field "ghost"/,
      );
    });

    test("filter.field existiert aber filterable=false → Throw", () => {
      expect(() => validateBoot([makeFeature({ field: "secret", op: "eq", value: "x" })])).toThrow(
        /filter references field "secret" which is not filterable/,
      );
    });

    test("filter.op=lt auf text-Feld → Throw (op-vs-Type-Compat)", () => {
      expect(() => validateBoot([makeFeature({ field: "status", op: "lt", value: "x" })])).toThrow(
        /filter\.op "lt" is not allowed on field "status" \(type "text"\)/,
      );
    });

    test("filter.op=gt auf number-Feld → kein Throw (vergleichbar)", () => {
      expect(() =>
        validateBoot([
          makeFeature(
            { field: "rank", op: "gt", value: 5 },
            {
              name: { type: "text", filterable: true },
              rank: { type: "number", filterable: true },
            },
          ),
        ]),
      ).not.toThrow();
    });

    test('filter.op="in" mit non-array value → Throw', () => {
      expect(() =>
        validateBoot([makeFeature({ field: "status", op: "in", value: "active" })]),
      ).toThrow(/filter\.op "in" requires filter\.value to be a readonly array/);
    });

    test('filter.op="in" mit array → kein Throw', () => {
      expect(() =>
        validateBoot([makeFeature({ field: "status", op: "in", value: ["active", "pending"] })]),
      ).not.toThrow();
    });

    test("filter.op=ne auf boolean → kein Throw, lt auf boolean → Throw", () => {
      const fields = {
        name: { type: "text", filterable: true },
        flag: { type: "boolean", filterable: true },
      };
      expect(() =>
        validateBoot([makeFeature({ field: "flag", op: "ne", value: true }, fields)]),
      ).not.toThrow();
      expect(() =>
        validateBoot([makeFeature({ field: "flag", op: "lt", value: true }, fields)]),
      ).toThrow(/filter\.op "lt" is not allowed on field "flag" \(type "boolean"\)/);
    });
  });

  // --- Tier 2.7d: actionForm-Screen ---
  // Non-CRUD Write-Handler-driven Form. Sechs Author-Code-Checks am
  // Boot: handler ist non-empty + registriert, fields non-empty +
  // jeder mit type, layout konsistent, redirect (wenn gesetzt) zeigt
  // auf einen registrierten Screen.
  describe("actionForm screen (Tier 2.7d)", () => {
    type ActionFormOverride = {
      readonly handler?: string | undefined;
      readonly fields?: Record<string, unknown>;
      readonly sections?: ReadonlyArray<{
        readonly title: string;
        readonly fields: readonly string[];
      }>;
      readonly redirect?: string;
      readonly cancelTarget?: string | false;
      readonly extraScreens?: readonly string[];
    };

    // Hilfs-Schema-Setup: stamps eine Test-Entity + write-handler
    // damit `r.writeHandler(defineEntityWriteHandler("invoice:approve",...))`
    // beim Boot ohne Custom-Code registriert werden kann. Plus optional
    // weitere Screens zum redirect-Test.
    function makeFeature(override: ActionFormOverride = {}) {
      const handler = override.handler ?? "shop:write:invoice:approve";
      const fields = override.fields ?? {
        note: { type: "text" },
        priority: { type: "number" },
      };
      const sections = override.sections ?? [{ title: "Approval", fields: ["note", "priority"] }];
      return defineFeature("shop", (r) => {
        // Registrierter Write-Handler den die actionForm referenzieren
        // kann. Nicht über defineEntityWriteHandler — das verlangt eine
        // existente Entity. Direkter Stub reicht für Boot-Validierung.
        r.writeHandler({
          name: "invoice:approve",
          schema: { _type: "stub" } as never,
          handler: async () => ({ isSuccess: true, data: {} }) as never,
          access: { openToAll: true },
        });
        r.screen({
          id: "approve-invoice",
          type: "actionForm",
          handler,
          fields: fields as never,
          layout: { sections: sections as never },
          ...(override.redirect !== undefined && { redirect: override.redirect }),
          ...(override.cancelTarget !== undefined && { cancelTarget: override.cancelTarget }),
        });
        for (const extra of override.extraScreens ?? []) {
          r.screen({
            id: extra,
            type: "custom",
            renderer: { react: "stub" },
          });
        }
      });
    }

    test("happy path: handler + fields + layout konsistent → kein Throw", () => {
      expect(() => validateBoot([makeFeature()])).not.toThrow();
    });

    test("handler nicht als write-handler registriert → Throw mit Hinweis", () => {
      expect(() => validateBoot([makeFeature({ handler: "shop:query:invoice:list" })])).toThrow(
        /handler "shop:query:invoice:list" is not a registered write-handler/,
      );
    });

    test("handler leer → Throw", () => {
      expect(() => validateBoot([makeFeature({ handler: "" })])).toThrow(
        /has empty or non-string handler/,
      );
    });

    test("fields empty-Map → Throw", () => {
      expect(() => validateBoot([makeFeature({ fields: {} })])).toThrow(
        /has empty fields map — declare at least one field/,
      );
    });

    test("field ohne type-Discriminator → Throw", () => {
      expect(() => validateBoot([makeFeature({ fields: { note: { required: true } } })])).toThrow(
        /field "note" has no `type` set/,
      );
    });

    test("layout.sections leer → Throw", () => {
      expect(() => validateBoot([makeFeature({ sections: [] })])).toThrow(
        /has an empty sections list/,
      );
    });

    test("section.fields leer → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ sections: [{ title: "Empty", fields: [] }] })]),
      ).toThrow(/section "Empty" with zero fields/);
    });

    test("layout referenziert unknown field → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ sections: [{ title: "x", fields: ["ghost"] }] })]),
      ).toThrow(/layout references unknown field "ghost"/);
    });

    test("redirect → existing screen-id im selben feature → kein Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ redirect: "after-form", extraScreens: ["after-form"] })]),
      ).not.toThrow();
    });

    test("redirect → unknown screen-id → Throw", () => {
      expect(() => validateBoot([makeFeature({ redirect: "ghost-screen" })])).toThrow(
        /redirect "ghost-screen" does not resolve to a registered screen/,
      );
    });

    test("cancelTarget → existing screen-id → kein Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ cancelTarget: "after-form", extraScreens: ["after-form"] })]),
      ).not.toThrow();
    });

    test("cancelTarget → unknown screen-id → Throw", () => {
      expect(() => validateBoot([makeFeature({ cancelTarget: "ghost-screen" })])).toThrow(
        /cancelTarget "ghost-screen" does not resolve to a registered screen/,
      );
    });

    test("cancelTarget=false (Button abgeschaltet) → kein Throw", () => {
      expect(() => validateBoot([makeFeature({ cancelTarget: false })])).not.toThrow();
    });

    test("extension section ohne component → Throw (Parität zu entityEdit)", () => {
      // synthesizeActionFormScreen reicht die layout 1:1 an RenderEdit weiter —
      // eine Extension-Section ohne react/native-Marker rendert sonst stumm leer.
      const section = { kind: "extension", title: "Custom", component: {} };
      expect(() => validateBoot([makeFeature({ sections: [section] as never })])).toThrow(
        /\(actionForm\) extension section "Custom" has no component/,
      );
    });

    test("extension section mit react component → kein Throw", () => {
      const section = { kind: "extension", title: "Custom", component: { react: "Panel" } };
      expect(() => validateBoot([makeFeature({ sections: [section] as never })])).not.toThrow();
    });
  });

  // --- configEdit-Screen ---
  // Form gegen das bundled config-feature. Boot-Validator prüft:
  //   1) fields non-empty + jeder mit type-Discriminator
  //   2) layout konsistent (Sections non-empty, Field-Refs existieren)
  //   3) jedes Field hat einen Eintrag in configKeys
  //   4) jeder qualifizierte Config-Key in configKeys ist tatsächlich
  //      via r.config(...) registriert
  describe("configEdit screen", () => {
    type ConfigEditOverride = {
      readonly fields?: Record<string, unknown>;
      readonly sections?: ReadonlyArray<{
        readonly title: string;
        readonly fields: readonly string[];
      }>;
      readonly configKeys?: Readonly<Record<string, string>>;
    };

    function makeFeature(override: ConfigEditOverride = {}) {
      const fields = override.fields ?? {
        siteName: { type: "text" },
        maxUploadMb: { type: "number" },
      };
      const sections = override.sections ?? [
        { title: "Basics", fields: ["siteName", "maxUploadMb"] },
      ];
      const configKeys = override.configKeys ?? {
        siteName: "shop:config:site-name",
        maxUploadMb: "shop:config:max-upload-mb",
      };
      return defineFeature("shop", (r) => {
        r.config({
          keys: {
            "site-name": createTenantConfig("text", { default: "" }),
            "max-upload-mb": createTenantConfig("number", { default: 10 }),
          },
        });
        r.screen({
          id: "settings",
          type: "configEdit",
          scope: "tenant",
          configKeys,
          fields: fields as never,
          layout: { sections: sections as never },
        });
      });
    }

    test("happy path: alle 4 Checks bestanden → kein Throw", () => {
      expect(() => validateBoot([makeFeature()])).not.toThrow();
    });

    test("fields empty-Map → Throw", () => {
      expect(() => validateBoot([makeFeature({ fields: {} })])).toThrow(
        /has empty fields map — declare at least one field/,
      );
    });

    test("field ohne type-Discriminator → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ fields: { siteName: { required: true } } })]),
      ).toThrow(/field "siteName" has no `type` set/);
    });

    test("layout.sections leer → Throw", () => {
      expect(() => validateBoot([makeFeature({ sections: [] })])).toThrow(
        /has an empty sections list/,
      );
    });

    test("layout referenziert unknown field → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ sections: [{ title: "x", fields: ["ghost"] }] })]),
      ).toThrow(/layout references unknown field "ghost"/);
    });

    test("Field ohne configKeys-Eintrag → Throw mit Hinweis auf Mapping", () => {
      // siteName ist im fields-Map, aber configKeys mappt es nicht.
      // Boot soll fehlschlagen weil zur Laufzeit kein Wert geladen
      // werden könnte.
      expect(() =>
        validateBoot([
          makeFeature({
            configKeys: { maxUploadMb: "shop:config:max-upload-mb" },
          }),
        ]),
      ).toThrow(/field "siteName" hat keinen Eintrag in configKeys-Map/);
    });

    test("configKeys referenziert unbekannten qualifizierten Key → Throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            configKeys: {
              siteName: "shop:config:typo-here",
              maxUploadMb: "shop:config:max-upload-mb",
            },
          }),
        ]),
      ).toThrow(/Config-Key "shop:config:typo-here" ist in keiner Feature-Registry deklariert/);
    });

    test("extension section ohne component → Throw (Parität zu entityEdit)", () => {
      // synthesizeConfigEditScreen reicht die layout 1:1 an RenderEdit weiter —
      // eine Extension-Section ohne react/native-Marker rendert sonst stumm leer.
      const section = { kind: "extension", title: "Custom", component: {} };
      expect(() => validateBoot([makeFeature({ sections: [section] as never })])).toThrow(
        /\(configEdit\) extension section "Custom" has no component/,
      );
    });

    test("extension section mit react component → kein Throw", () => {
      const section = { kind: "extension", title: "Custom", component: { react: "Panel" } };
      expect(() => validateBoot([makeFeature({ sections: [section] as never })])).not.toThrow();
    });
  });

  // --- entityEdit extension section ---
  // Eine extension-Section delegiert das Rendering an eine feature-provided
  // PlatformComponent (custom-fields-Panel etc.), die client-seitig per Name
  // aufgelöst wird. Ohne react/native-Marker bliebe der Slot zur Laufzeit leer
  // — Boot-Fail statt stummem Loch. Field-Sections bleiben davon unberührt.
  describe("entityEdit extension section", () => {
    function makeFeature(component: unknown) {
      return defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: { name: createTextField() } }));
        r.screen({
          id: "product-edit",
          type: "entityEdit",
          entity: "product",
          layout: {
            sections: [
              { kind: "extension", title: "Custom Fields", component: component as never },
            ],
          },
        });
      });
    }

    test("extension section ohne react/native component → Throw", () => {
      expect(() => validateBoot([makeFeature({})])).toThrow(
        /extension section "Custom Fields" has no component — declare a react\/native component marker/,
      );
    });

    test("extension section mit react component → kein Throw", () => {
      expect(() => validateBoot([makeFeature({ react: "CustomFieldsPanel" })])).not.toThrow();
    });

    test("extension section mit native component → kein Throw", () => {
      expect(() => validateBoot([makeFeature({ native: "CustomFieldsPanel" })])).not.toThrow();
    });
  });

  // --- Tier 2.7e-3: ReferenceFieldDef ---
  describe("reference field (Tier 2.7e-3)", () => {
    // Helper: registriert einen Stub-Query-Handler `<entity>:list`
    // damit der Boot-Validator den Audit-Fix-#2-Check (Handler-
    // Existenz auf der target-Entity) durch lässt.
    function stubListHandler(
      // biome-ignore lint/suspicious/noExplicitAny: Registrar-Typ ist generisch, hier reicht das.
      r: any,
      entityName: string,
    ): void {
      r.queryHandler({
        name: `${entityName}:list`,
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }) as never,
        access: { openToAll: true },
      });
    }

    test("reference auf bestehende Entity → kein Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity("customer", createEntity({ fields: { name: createTextField() } }));
          stubListHandler(r, "customer");
          r.entity(
            "order",
            createEntity({
              fields: {
                customerId: { type: "reference", entity: "customer", labelField: "name" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference auf unknown Entity → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(
            "order",
            createEntity({
              fields: {
                customerId: { type: "reference", entity: "ghost-entity" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "customerId" on entity "order" targets unknown entity "ghost-entity"/,
      );
    });

    test("reference labelField auf unknown Field → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity("customer", createEntity({ fields: { name: createTextField() } }));
          r.entity(
            "order",
            createEntity({
              fields: {
                customerId: { type: "reference", entity: "customer", labelField: "ghost-field" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /references labelField "ghost-field" which does not exist on entity "customer"/,
      );
    });

    test("reference labelField=id ist immer ok (PK)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity("customer", createEntity({ fields: { name: createTextField() } }));
          stubListHandler(r, "customer");
          r.entity(
            "order",
            createEntity({
              fields: {
                customerId: { type: "reference", entity: "customer", labelField: "id" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("self-reference (entity → entity) → kein Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(
            "category",
            createEntity({
              fields: {
                name: createTextField(),
                parentId: { type: "reference", entity: "category", labelField: "name" },
              },
            }),
          );
          stubListHandler(r, "category");
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference mit multiple: true → kein Throw (Tier 2.7e-Multi)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity("tag", createEntity({ fields: { name: createTextField() } }));
          stubListHandler(r, "tag");
          r.entity(
            "post",
            createEntity({
              fields: {
                title: createTextField(),
                tagIds: {
                  type: "reference",
                  entity: "tag",
                  labelField: "name",
                  multiple: true,
                },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    // --- Tier 2.7e Cross-Feature: "feature:entity"-Form ---
    test("cross-feature reference (feature:entity) → kein Throw", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity("user", createEntity({ fields: { email: createTextField() } }));
          stubListHandler(r, "user");
        }),
        defineFeature("shop", (r) => {
          r.entity(
            "order",
            createEntity({
              fields: {
                customerId: { type: "reference", entity: "users:user", labelField: "email" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("Audit-Fix #2: cross-feature reference ohne list-handler → Throw", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity("user", createEntity({ fields: { email: createTextField() } }));
          // KEINE stubListHandler — das ist der Punkt des Tests
        }),
        defineFeature("shop", (r) => {
          r.entity(
            "order",
            createEntity({
              fields: {
                customerId: { type: "reference", entity: "users:user" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /no list-query-handler is registered there\. Add r\.queryHandler\(defineEntityListHandler\("user"/,
      );
    });

    test("cross-feature reference auf unknown feature → Throw mit klarer Message", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(
            "order",
            createEntity({
              fields: {
                customerId: { type: "reference", entity: "ghost-feature:user" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /targets unknown feature "ghost-feature" via "ghost-feature:user"/,
      );
    });

    test("cross-feature reference auf unknown entity → Throw mit feature-context", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity("user", createEntity({ fields: { email: createTextField() } }));
        }),
        defineFeature("shop", (r) => {
          r.entity(
            "order",
            createEntity({
              fields: {
                customerId: { type: "reference", entity: "users:ghost-entity" },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /targets unknown entity "ghost-entity" in feature "users"/,
      );
    });

    test("cross-feature labelField auf unknown Field → Throw", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity("user", createEntity({ fields: { email: createTextField() } }));
        }),
        defineFeature("shop", (r) => {
          r.entity(
            "order",
            createEntity({
              fields: {
                customerId: {
                  type: "reference",
                  entity: "users:user",
                  labelField: "ghost-field",
                },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /references labelField "ghost-field" which does not exist on entity "user"/,
      );
    });
  });

  // --- Tier 2.7e-1: rowAction kind="navigate" target-existenz ---
  describe("entityList rowAction kind=navigate (Tier 2.7e-1)", () => {
    function makeFeature(targetScreen: string, withTarget: boolean) {
      return defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: { name: createTextField() } }));
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [
            {
              kind: "navigate",
              id: "edit",
              label: "actions.edit",
              screen: targetScreen,
            },
          ],
        });
        if (withTarget) {
          r.screen({
            id: targetScreen,
            type: "custom",
            renderer: { react: "stub" },
          });
        }
      });
    }

    test("navigate-target → registered screen → kein Throw", () => {
      expect(() => validateBoot([makeFeature("product-edit", true)])).not.toThrow();
    });

    test("navigate-target → unknown screen → Throw mit klarer Message", () => {
      expect(() => validateBoot([makeFeature("ghost-screen", false)])).toThrow(
        /rowAction "edit" navigate-target "ghost-screen" does not resolve/,
      );
    });
  });

  // --- rowAction kind="writeHandler" handler-QN-Validierung (Tier 2.7e-1 erw.) ---
  describe("entityList rowAction kind=writeHandler handler-QN", () => {
    function makeFeature(handlerQn: string, register: boolean) {
      return defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: { name: createTextField() } }));
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [{ id: "delete", label: "actions.delete", handler: handlerQn }],
        });
        if (register) {
          r.writeHandler(
            "delete",
            z.object({}),
            async () => ({ isSuccess: true as const, data: null }),
            {
              access: { roles: ["Admin"] },
            },
          );
        }
      });
    }

    test("handler → registriert → kein Throw", () => {
      expect(() => validateBoot([makeFeature("shop:write:delete", true)])).not.toThrow();
    });

    test("handler → nicht registriert → Throw mit klarer Message", () => {
      expect(() => validateBoot([makeFeature("shop:write:ghost", false)])).toThrow(
        /rowAction "delete" .*handler "shop:write:ghost" is not a registered write-handler/,
      );
    });
  });

  // --- rowAction payload-Extractor Feld-Referenzen (Tier 2.7e-3) ---
  // Row-Meta (id, version) ist auf jeder Entity-Row vorhanden ohne ein
  // Entity-Field zu sein — pick ["id", "version"] ist das Standard-Payload
  // für optimistic-lock-Lifecycle-Writes und darf den Boot nicht killen
  // (Prod-Incident publicstatus 2026-06-11: 0.40-Validator lehnte
  // maintenance-start/cancel/complete ab, CrashLoopBackOff).
  describe("entityList rowAction payload pick (Tier 2.7e-3)", () => {
    function makeFeature(pick: readonly string[]) {
      return defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: { name: createTextField() } }));
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [
            {
              id: "archive",
              label: "actions.archive",
              handler: "shop:write:archive",
              payload: { pick: [...pick] },
            },
          ],
        });
        r.writeHandler(
          "archive",
          z.object({}),
          async () => ({ isSuccess: true as const, data: null }),
          {
            access: { roles: ["Admin"] },
          },
        );
      });
    }

    test("pick mit Row-Meta id + version → kein Throw (optimistic-lock-Standard)", () => {
      expect(() => validateBoot([makeFeature(["id", "version"])])).not.toThrow();
    });

    test("pick mit Entity-Field → kein Throw", () => {
      expect(() => validateBoot([makeFeature(["id", "name"])])).not.toThrow();
    });

    test("pick mit unknown Field → Throw mit klarer Message", () => {
      expect(() => validateBoot([makeFeature(["id", "ghost"])])).toThrow(
        /rowAction "archive" payload references unknown field "ghost"/,
      );
    });
  });

  // --- toolbarAction navigate + writeHandler Validierung (Tier 2.7e-2) ---
  describe("entityList toolbarAction navigate (Tier 2.7e-2)", () => {
    function makeFeature(targetScreen: string, withTarget: boolean) {
      return defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: { name: createTextField() } }));
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          toolbarActions: [
            { kind: "navigate", id: "open-form", label: "actions.open", screen: targetScreen },
          ],
        });
        if (withTarget) {
          r.screen({ id: targetScreen, type: "custom", renderer: { react: "stub" } });
        }
      });
    }

    test("navigate-target → registriert → kein Throw", () => {
      expect(() => validateBoot([makeFeature("product-form", true)])).not.toThrow();
    });

    test("navigate-target → unbekannt → Throw mit klarer Message", () => {
      expect(() => validateBoot([makeFeature("ghost-form", false)])).toThrow(
        /toolbarAction "open-form" navigate-target "ghost-form" does not resolve/,
      );
    });
  });

  describe("entityList toolbarAction writeHandler handler-QN (Tier 2.7e-2)", () => {
    function makeFeature(handlerQn: string, register: boolean) {
      return defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: { name: createTextField() } }));
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          toolbarActions: [
            { kind: "writeHandler", id: "sync", label: "actions.sync", handler: handlerQn },
          ],
        });
        if (register) {
          r.writeHandler(
            "sync",
            z.object({}),
            async () => ({ isSuccess: true as const, data: null }),
            {
              access: { roles: ["Admin"] },
            },
          );
        }
      });
    }

    test("handler → registriert → kein Throw", () => {
      expect(() => validateBoot([makeFeature("shop:write:sync", true)])).not.toThrow();
    });

    test("handler → nicht registriert → Throw mit klarer Message", () => {
      expect(() => validateBoot([makeFeature("shop:write:ghost", false)])).toThrow(
        /toolbarAction "sync" .*handler "shop:write:ghost" is not a registered write-handler/,
      );
    });
  });

  // --- defaultSort funktioniert für ALLE Field-Types die sortable
  //     unterstützen (Tier 2.6b Field-Erweiterung) ---
  // Vor Tier 2.6b war `sortable` nur auf TextFieldDef. Erweitert auf
  // Number/Money/Date/Timestamp/Boolean/Select/LocatedTimestamp; der
  // Validator erkennt das via "sortable" in fieldDef. Diese Tests pinnen
  // dass der per-Field-Type-Roundtrip wirklich greift.
  describe("entityList defaultSort: alle sortable-Field-Types", () => {
    function buildFeature(fieldName: string, fields: Record<string, unknown>) {
      return defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: fields as never }));
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: [{ field: fieldName }],
          defaultSort: { field: fieldName, dir: "asc" },
        });
      });
    }

    test("number-Field mit sortable: true → kein Throw", () => {
      expect(() =>
        validateBoot([buildFeature("rank", { rank: { type: "number", sortable: true } })]),
      ).not.toThrow();
    });

    test("money-Field mit sortable: true → kein Throw", () => {
      expect(() =>
        validateBoot([buildFeature("price", { price: { type: "money", sortable: true } })]),
      ).not.toThrow();
    });

    test("date-Field mit sortable: true → kein Throw", () => {
      expect(() =>
        validateBoot([buildFeature("dueDate", { dueDate: { type: "date", sortable: true } })]),
      ).not.toThrow();
    });

    test("timestamp-Field mit sortable: true → kein Throw", () => {
      expect(() =>
        validateBoot([
          buildFeature("createdAt", { createdAt: { type: "timestamp", sortable: true } }),
        ]),
      ).not.toThrow();
    });

    test("boolean-Field mit sortable: true → kein Throw", () => {
      expect(() =>
        validateBoot([buildFeature("isActive", { isActive: { type: "boolean", sortable: true } })]),
      ).not.toThrow();
    });

    test("select-Field mit sortable: true → kein Throw", () => {
      expect(() =>
        validateBoot([
          buildFeature("status", {
            status: { type: "select", options: ["a", "b"], sortable: true },
          }),
        ]),
      ).not.toThrow();
    });

    test("locatedTimestamp-Field mit sortable: true → kein Throw", () => {
      expect(() =>
        validateBoot([
          buildFeature("pickup", { pickup: { type: "locatedTimestamp", sortable: true } }),
        ]),
      ).not.toThrow();
    });

    test("number-Field OHNE sortable → Throw (sortable: true ist Pflicht)", () => {
      expect(() => validateBoot([buildFeature("rank", { rank: { type: "number" } })])).toThrow(
        /is not sortable/,
      );
    });
  });

  // --- screen.id ohne Punkt ---
  // Renderer nutzt screen.id als URL-Param-Namespace (`<id>.sort=…`).
  // defineFeature() rejected screen-ids mit '.' bereits über den
  // kebab-case-Check (define-feature.ts) — bevor der Boot-Validator
  // dran kommt. Wir pinnen hier nur dass der Reject am Author-API-
  // Eingangstor passiert, mit klarer Message.
  describe("screen.id constraints", () => {
    test('screen.id mit "." → defineFeature throws (kebab-case)', () => {
      expect(() =>
        defineFeature("shop", (r) => {
          r.entity("product", createEntity({ fields: { name: createTextField() } }));
          r.screen({
            id: "product.list",
            type: "entityList",
            entity: "product",
            columns: ["name"],
          });
        }),
      ).toThrow(/kebab-case/);
    });

    test("screen.id im kebab-case → kein Throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity("product", createEntity({ fields: { name: createTextField() } }));
        r.screen({ id: "product-list", type: "entityList", entity: "product", columns: ["name"] });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });
  });
});

describe("boot-validator — config key backing × scope", () => {
  test("rejects backing:secrets on a non-system scope (secrets do not cascade)", () => {
    const feature = defineFeature("billing", (r) => {
      r.config({ keys: { apiKey: createTenantConfig("text", { backing: "secrets" }) } });
    });
    expect(() => validateBoot([feature])).toThrow(/backing="secrets".*requires scope="system"/i);
  });

  test("rejects backing:secrets even system-scoped until the dispatch is wired (framework#333)", () => {
    const feature = defineFeature("billing", (r) => {
      r.config({ keys: { apiKey: createSystemConfig("text", { backing: "secrets" }) } });
    });
    expect(() => validateBoot([feature])).toThrow(/not yet wired.*333/i);
  });

  test("a config key without secrets backing boots fine", () => {
    const feature = defineFeature("billing", (r) => {
      r.config({ keys: { apiKey: createSystemConfig("text") } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});

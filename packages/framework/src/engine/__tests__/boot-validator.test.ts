import { describe, expect, test } from "vitest";
import { z } from "zod";
import { validateBoot } from "../boot-validator";
import { createSystemConfig, createTenantConfig } from "../config-helpers";
import { createEntity, createTextField, defineFeature } from "../index";

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
});

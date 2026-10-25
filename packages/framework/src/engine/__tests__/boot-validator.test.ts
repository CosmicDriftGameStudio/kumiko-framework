import { describe, expect, spyOn, test } from "bun:test";
import {
  createTestEnvelopeCipher,
  withBootValidatorFixture,
} from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import type { SchemaTable } from "../../db/dialect.ts";
import { table, text } from "../../db/dialect.ts";
import { rowMetaFieldNames } from "../../db/table-builder.ts";

import { LIST_ROW_META_COLUMNS } from "../../ui-types/list-row-meta.ts";
import { validateEntityListScreens } from "../boot-validator/entity-list-screens.ts";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { createSystemConfig, createTenantConfig } from "../config-helpers.ts";
import {
  createDerivedField,
  createEmbeddedField,
  createEmbeddedListField,
  createEntity,
  createFilesField,
  createImageField,
  createImagesField,
  createJsonbField,
  createMultiSelectField,
  createTextField,
  defineFeature,
  from,
} from "../index.ts";
import type { RowFieldExtractor } from "../types/screen.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

// Registers a stub `<entity>:list` query handler so the boot validator's
// handler-existence check for the target entity passes. Used by both top-level
// and embedded-list reference-field tests.
function stubListHandler(
  // biome-ignore lint/suspicious/noExplicitAny: the registrar type is generic; any is enough for this stub.
  r: any,
  entityName: string,
): void {
  r.queryHandler({
    name: `${entityName}:list`,
    schema: z.object({}),
    handler: async () => ({ rows: [], nextCursor: null }) as never,
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
}

describe("boot-validator", () => {
  function noteFeatureWithColumn(columnName: string, options?: { readonly softDelete?: boolean }) {
    return defineFeature("notes", (r) => {
      r.entity({
        name: "note",
        ...createEntity({
          fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
          softDelete: options?.softDelete,
        }),
      });
      r.screen({
        id: "note-list",
        type: "entityList",
        entity: "note",
        columns: ["title", columnName],
      });
    });
  }

  test("passes for valid features with no issues", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "user",
          ...createEntity({
            table: "Users",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  // --- Circular dependencies ---

  test("detects circular requires: A → B → A", () => {
    const features = [
      defineFeature("a", (r) => {
        r.requires({ features: ["b"] });
      }),
      defineFeature("b", (r) => {
        r.requires({ features: ["a"] });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/circular dependency.*a.*b/i);
  });

  test("detects circular requires: A → B → C → A", () => {
    const features = [
      defineFeature("a", (r) => {
        r.requires({ features: ["b"] });
      }),
      defineFeature("b", (r) => {
        r.requires({ features: ["c"] });
      }),
      defineFeature("c", (r) => {
        r.requires({ features: ["a"] });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/circular dependency/i);
  });

  test("no circular dependency for diamond shape: A → B, A → C, B → D, C → D", () => {
    const features = [
      defineFeature("d", () => {}),
      defineFeature("b", (r) => {
        r.requires({ features: ["d"] });
      }),
      defineFeature("c", (r) => {
        r.requires({ features: ["d"] });
      }),
      defineFeature("a", (r) => {
        r.requires({ features: ["b", "c"] });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  // --- encrypted + searchable ---

  test("rejects encrypted + searchable field", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "secret",
          ...createEntity({
            table: "Secrets",
            fields: {
              apiKey: {
                type: "text",
                allowPlaintext: "test fixture value, not personal data",
                encrypted: true,
                searchable: true,
              },
            },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(
      /apiKey.*cannot be both encrypted and searchable/i,
    );
  });

  // --- searchable + restricted read access ---

  function searchableFeatureWith(
    field: Record<string, unknown>,
  ): ReturnType<typeof defineFeature>[] {
    return [
      defineFeature("a", (r) => {
        r.entity({
          name: "memo",
          ...createEntity({
            table: "Memos",
            fields: {
              secret: {
                type: "text",
                allowPlaintext: "test fixture value, not personal data",
                personal: false,
                reason: "test_fixture",
                ...field,
              } as never, // @cast-boundary test builds field variants dynamically
            },
          }),
        });
      }),
    ];
  }

  test("rejects a searchable field with a restricted access.read", () => {
    expect(() =>
      validateBoot(searchableFeatureWith({ searchable: true, access: { read: ["Admin"] } })),
    ).toThrow(/secret.*cannot be searchable with a restricted access\.read/i);
  });

  function embeddedSearchableFeature(
    subField: Record<string, unknown>,
    parent: Record<string, unknown> = {},
  ) {
    return defineFeature("memos", (r) => {
      r.entity({
        name: "memo",
        ...createEntity({
          table: "Memos",
          fields: {
            note: {
              type: "embedded",
              schema: { body: { type: "text", searchable: true, ...subField } },
              ...parent,
            } as never, // @cast-boundary test builds embedded variants dynamically
          },
        }),
      });
    });
  }

  test("rejects a searchable embedded sub-field with a restricted access.read", () => {
    expect(() =>
      validateBoot([embeddedSearchableFeature({ access: { read: ["Admin"] } })]),
    ).toThrow(/note\.body.*cannot be searchable with a restricted access\.read/i);
  });

  test("rejects a searchable embedded sub-field under a parent with a restricted access.read", () => {
    expect(() =>
      validateBoot([embeddedSearchableFeature({}, { access: { read: ["Admin"] } })]),
    ).toThrow(/note\.body.*cannot be searchable with a restricted access\.read/i);
  });

  test("allows a searchable embedded sub-field without restricted access.read", () => {
    expect(() => validateBoot([embeddedSearchableFeature({})])).not.toThrow();
  });

  test("allows a searchable field without access.read or with an empty one", () => {
    expect(() => validateBoot(searchableFeatureWith({ searchable: true }))).not.toThrow();
    expect(() =>
      validateBoot(searchableFeatureWith({ searchable: true, access: { read: [] } })),
    ).not.toThrow();
  });

  test("allows a restricted access.read on a non-searchable field", () => {
    expect(() =>
      validateBoot(searchableFeatureWith({ access: { read: ["Admin"] } })),
    ).not.toThrow();
  });

  test("rejects encrypted + sortable field", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "secret",
          ...createEntity({
            table: "Secrets",
            fields: {
              token: {
                type: "text",
                allowPlaintext: "test fixture value, not personal data",
                encrypted: true,
                sortable: true,
              },
            },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/token.*cannot be both encrypted and sortable/i);
  });

  test("allows encrypted field when a master key keyring is available", () => {
    process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = Buffer.from(
      "0123456789abcdef0123456789abcdef",
    ).toString("base64");
    try {
      const features = [
        defineFeature("a", (r) => {
          r.entity({
            name: "secret",
            ...createEntity({
              table: "Secrets",
              fields: {
                apiKey: {
                  type: "text",
                  allowPlaintext: "test fixture value, not personal data",
                  encrypted: true,
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    } finally {
      delete process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
    }
  });

  test("throws at boot when the master key is malformed (not 32 bytes)", () => {
    process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = Buffer.from("too-short").toString("base64");
    try {
      const features = [
        defineFeature("a", (r) => {
          r.entity({
            name: "secret",
            ...createEntity({
              table: "Secrets",
              fields: {
                apiKey: {
                  type: "text",
                  allowPlaintext: "test fixture value, not personal data",
                  encrypted: true,
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/master key/i);
    } finally {
      delete process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
    }
  });

  test("throws when encrypted fields exist but no master key is available", () => {
    delete process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "secret",
          ...createEntity({
            table: "Secrets",
            fields: {
              apiKey: {
                type: "text",
                allowPlaintext: "test fixture value, not personal data",
                encrypted: true,
              },
            },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/master key/i);
  });

  describe("entityFieldCipher option", () => {
    const encryptedFeatures = [
      defineFeature("a", (r) => {
        r.entity({
          name: "secret",
          ...createEntity({
            table: "Secrets",
            fields: {
              apiKey: {
                type: "text",
                allowPlaintext: "test fixture value, not personal data",
                encrypted: true,
              },
            },
          }),
        });
      }),
    ];

    test("a runner-provided cipher satisfies encrypted fields without any env KEK", () => {
      const cipher = createTestEnvelopeCipher(Buffer.alloc(32, 7).toString("base64"));
      expect(() =>
        validateBootRaw(withBootValidatorFixture(encryptedFeatures), {
          env: {},
          entityFieldCipher: cipher,
        }),
      ).not.toThrow();
    });

    test("without the cipher and without an env KEK the error names both ways out", () => {
      expect(() =>
        validateBootRaw(withBootValidatorFixture(encryptedFeatures), { env: {} }),
      ).toThrow(/KUMIKO_SECRETS_MASTER_KEY_V1.*masterKey/s);
    });
  });

  test("throws when longText encrypted field exists but no master key is available", () => {
    // Ensures `validateEncryptedFields` checks both string field types. Previously,
    // `if (field.type !== "text") continue;` skipped encrypted `longText` fields,
    // so the `ENCRYPTION_KEY` check never ran and encryption could fail silently.
    delete process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "doc",
          ...createEntity({
            table: "Docs",
            fields: {
              body: {
                type: "longText",
                allowPlaintext: "test fixture value, not personal data",
                encrypted: true,
              },
            },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/master key/i);
  });

  test("rejects encrypted text field that is also filterable", () => {
    // AES-GCM draws a random IV per call, so the ciphertext is non-
    // deterministic — an equality filter on it would never match, even
    // against the identical plaintext.
    process.env["ENCRYPTION_KEY"] = "test-key";
    try {
      const features = [
        defineFeature("a", (r) => {
          r.entity({
            name: "doc",
            ...createEntity({
              table: "Docs",
              fields: {
                secret: {
                  type: "text",
                  allowPlaintext: "test fixture value, not personal data",
                  encrypted: true,
                  filterable: true,
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/secret.*encrypted and filterable/i);
    } finally {
      delete process.env["ENCRYPTION_KEY"];
    }
  });

  test("rejects a unique index on an encrypted column", () => {
    // Same non-determinism as the filterable case: a unique index can never
    // detect a real duplicate plaintext behind two different ciphertexts.
    process.env["ENCRYPTION_KEY"] = "test-key";
    try {
      const features = [
        defineFeature("a", (r) => {
          r.entity({
            name: "doc",
            ...createEntity({
              table: "Docs",
              fields: {
                secret: {
                  type: "text",
                  allowPlaintext: "test fixture value, not personal data",
                  encrypted: true,
                },
              },
              indexes: [{ columns: ["secret"], unique: true }],
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/secret.*encrypted.*unique index/i);
    } finally {
      delete process.env["ENCRYPTION_KEY"];
    }
  });

  // --- index-validator longText block ---

  test("rejects longText field in entity.indexes (longText is not indexable)", () => {
    // Prevents a BTREE index from being built on a 1-MB text column, which could
    // cause severe performance problems when dereferencing TOAST pages. `longText`
    // is semantically non-indexable, consistent with the type-level `sortable=false`.
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "doc",
          ...createEntity({
            table: "Docs",
            fields: {
              body: { type: "longText", allowPlaintext: "test fixture value, not personal data" },
              title: { type: "text", allowPlaintext: "test fixture value, not personal data" },
            },
            indexes: [{ columns: ["title", "body"] }],
          }),
        });
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
      r.entity({ name: "vehicle", ...createEntity({ table: "Vehicles", fields: {} }) });
      r.useExtension("tags", "vehicle");
      // Missing: r.requires({ features: ["tags"] })
    });

    expect(() => validateBoot([ext, consumer])).toThrow(/fleet.*uses extension "tags".*requires/i);
  });

  test("passes when extension used with requires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.requires({ features: ["tags"] });
      r.entity({ name: "vehicle", ...createEntity({ table: "Vehicles", fields: {} }) });
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
      r.entity({ name: "vehicle", ...createEntity({ table: "Vehicles", fields: {} }) });
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
      r.entity({ name: "dummy", ...createEntity({ table: "Dummies", fields: {} }) });
      r.useExtension("tenantTierResolver", "dummy", { build: async () => () => new Set() });
    });
    expect(() => validateBoot([self])).not.toThrow();
  });

  // --- FILE_STORAGE_PROVIDER ---

  test("throws when file fields exist but FILE_STORAGE_PROVIDER not set", () => {
    delete process.env["FILE_STORAGE_PROVIDER"];
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "doc",
          ...createEntity({
            table: "Docs",
            fields: { contract: { type: "file" } },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/FILE_STORAGE_PROVIDER.*required/i);
  });

  test("passes when file fields exist and FILE_STORAGE_PROVIDER is set", () => {
    process.env["FILE_STORAGE_PROVIDER"] = "local";
    try {
      const features = [
        defineFeature("a", (r) => {
          r.entity({
            name: "doc",
            ...createEntity({
              table: "Docs",
              fields: { photo: { type: "image" } },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    } finally {
      delete process.env["FILE_STORAGE_PROVIDER"];
    }
  });

  test("file-storage gate reads the injected env option, not process.env", () => {
    delete process.env["FILE_STORAGE_PROVIDER"];
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "doc",
          ...createEntity({ table: "Docs", fields: { photo: { type: "image" } } }),
        });
      }),
    ];
    const fixtured = withBootValidatorFixture(features);
    expect(() =>
      validateBootRaw(fixtured, { env: { FILE_STORAGE_PROVIDER: "s3-env" } }),
    ).not.toThrow();
    expect(() => validateBootRaw(fixtured, { env: {} })).toThrow(
      /FILE_STORAGE_PROVIDER.*required/i,
    );
  });

  // --- extendSchema column collision ---

  test("throws when extendSchema column conflicts with existing field", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "item",
          ...createEntity({
            table: "Items",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.extendsRegistrar("custom", {
          extendSchema: () => ({
            name: {
              type: "text" as const,
              allowPlaintext: "test fixture value, not personal data",
            },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(
      /extendSchema column "name" conflicts.*entity "item"/i,
    );
  });

  // --- derivedFields / fields collision ---

  test("throws when a derivedFields key conflicts with a stored field", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "item",
          ...createEntity({
            table: "Items",
            fields: { status: createTextField({ personal: false, reason: "test_fixture" }) },
            derivedFields: {
              status: createDerivedField({ valueType: "text", derive: () => "computed" }),
            },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(
      /entity "item".*derivedFields key "status".*conflicts/i,
    );
  });

  test("passes when derivedFields keys don't conflict with stored fields", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "item",
          ...createEntity({
            table: "Items",
            fields: { status: createTextField({ personal: false, reason: "test_fixture" }) },
            derivedFields: {
              statusLabel: createDerivedField({ valueType: "text", derive: () => "computed" }),
            },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
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
              allowPlaintext: "test fixture value, not personal data",
              scope: "tenant",
              access: { read: ["all"], write: ["Admin"] },
            },
          },
        });
      }),
      defineFeature("invoicing", (r) => {
        r.requires({ features: ["payments"] });
        r.readsConfig("payments.gateway");
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("passes when extendSchema adds non-conflicting column", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity({
          name: "item",
          ...createEntity({
            table: "Items",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.extendsRegistrar("custom", {
          extendSchema: () => ({
            extra: {
              type: "text" as const,
              allowPlaintext: "test fixture value, not personal data",
            },
          }),
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  // --- Write-handler entity-mapping (smart tryMapEntity + extension preSave) ---

  test("accepts bare CRUD write handler when feature name matches entity", () => {
    const features = [
      defineFeature("credit", (r) => {
        r.entity({
          name: "credit",
          ...createEntity({
            table: "Credits",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.writeHandler({
          name: "create",
          schema: z.object({ name: z.string() }),
          handler: async () => ({
            isSuccess: true as const,
            data: { id: "1" },
          }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
    expect(features[0]?.handlerEntityMappings["create"]).toBe("credit");
  });

  test("throws when extension preSave targets entity with no mapped write handlers", () => {
    const ext = defineFeature("cap-ext", (r) => {
      r.extendsRegistrar("credit-cap", {
        hooks: {
          preSave: async (changes) => changes,
        },
      });
    });
    const consumer = defineFeature("money-horse", (r) => {
      r.requires({ features: ["cap-ext"] });
      r.entity({
        name: "credit",
        ...createEntity({
          table: "Credits",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.writeHandler({
        name: "doSomething",
        schema: z.object({}),
        handler: async () => ({
          isSuccess: true as const,
          data: {},
        }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.useExtension("credit-cap", "credit");
    });
    expect(() => validateBoot([ext, consumer])).toThrow(
      /no write handler is entity-mapped to "credit"/i,
    );
  });

  // --- Handler access validation (default-deny) ---

  test("throws when a write handler has no access rule", () => {
    // Access is a required option — the registrar itself throws
    // before validateBoot ever runs.
    expect(() =>
      defineFeature("a", (r) => {
        // @ts-expect-error options.access is required.
        r.writeHandler({
          name: "createThing",
          schema: z.object({ name: z.string() }),
          handler: async () => ({
            isSuccess: true as const,
            data: {},
          }),
        });
      }),
    ).toThrow(/r\.writeHandler\(\{ name: "createThing" \}\) requires an access rule/);
  });

  test("throws when a query handler has no access rule", () => {
    expect(() =>
      defineFeature("a", (r) => {
        // @ts-expect-error options.access is required.
        r.queryHandler({ name: "list", schema: z.object({}), handler: async () => [] });
      }),
    ).toThrow(/r\.queryHandler\(\{ name: "list" \}\) requires an access rule/);
  });

  test("validateBoot rejects a hand-built feature definition whose handler has no access rule", () => {
    const base = defineFeature("a", () => {});
    const handBuilt = {
      ...base,
      writeHandlers: {
        createThing: {
          name: "createThing",
          schema: z.object({}),
          handler: async () => ({ isSuccess: true as const, data: {} }),
          access: undefined,
        },
      },
    };
    // @ts-expect-error access is required on a stored handler; this is the hand-built bypass
    expect(() => validateBoot([handBuilt])).toThrow(/is missing an access rule/);
  });

  test("r.crud without access options fails registration (no implicit openToAll)", () => {
    const widgetEntity = createEntity({
      table: "phase0_widgets",
      fields: {
        name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
    });
    // Access is required — r.crud now throws at
    // registration time (was: caught at boot-validator level).
    expect(() =>
      defineFeature("phase0", (r) => {
        r.crud("widget", widgetEntity);
      }),
    ).toThrow(/no access rule resolved/i);
  });

  test("accepts role-based access rule", () => {
    const features = [
      defineFeature("a", (r) => {
        r.queryHandler({
          name: "list",
          schema: z.object({}),
          handler: async () => [],
          access: { roles: ["Admin"] },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("accepts openToAll access rule", () => {
    const features = [
      defineFeature("a", (r) => {
        r.queryHandler({
          name: "list",
          schema: z.object({}),
          handler: async () => [],
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("warns when a role is used by exactly one handler, reached through the real validateBoot wiring", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const features = [
        defineFeature("a", (r) => {
          r.queryHandler({
            name: "list",
            schema: z.object({}),
            handler: async () => [],
            access: { roles: ["OnlyHereRole"] },
          });
        }),
      ];
      validateBootRaw(withBootValidatorFixture(features), { warnOnUniqueAccessRoles: true });
      // Not toHaveBeenCalledTimes(1): this file's tests share the process-global
      // console.warn and run with the default concurrency (bunfig.toml) — other
      // concurrently-running tests' own "role used by one handler" warnings can
      // land on this spy too. Assert the wiring fired at least once instead.
      expect(
        warnSpy.mock.calls.some((call) =>
          (call[0] as string | undefined)?.includes("OnlyHereRole"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("does NOT warn on unique access roles by default — opt-in only", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const features = [
        defineFeature("b", (r) => {
          r.queryHandler({
            name: "list",
            schema: z.object({}),
            handler: async () => [],
            access: { roles: ["OnlyThereRole"] },
          });
        }),
      ];
      validateBoot(features);
      expect(
        warnSpy.mock.calls.some((call) =>
          (call[0] as string | undefined)?.includes("OnlyThereRole"),
        ),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("throws when a stream handler has no access rule", () => {
    expect(() =>
      defineFeature("a", (r) => {
        // @ts-expect-error options.access is required.
        r.streamHandler("chat:complete", z.object({}), async function* () {});
      }),
    ).toThrow(/requires schema \+ handler \+ options\.access/);
  });

  test("object-form streamHandler with access rule passes boot", () => {
    const features = [
      defineFeature("a", (r) => {
        r.streamHandler({
          name: "chat:complete",
          schema: z.object({}),
          handler: async function* () {},
          access: { roles: ["User"] },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("accepts openToAll access rule on a stream handler", () => {
    const features = [
      defineFeature("a", (r) => {
        r.streamHandler("chat:complete", z.object({}), async function* () {}, {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("throws when an anonymous stream handler uses a user-bucketed rate limit", () => {
    const features = [
      defineFeature("a", (r) => {
        r.streamHandler("chat:complete", z.object({}), async function* () {}, {
          access: { roles: ["anonymous"] },
          rateLimit: { per: "user", limit: 10, windowSeconds: 60 },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(
      /stream handler "a:stream:chat:complete" allows anonymous callers/i,
    );
  });

  test("accepts an anonymous stream handler with an ip-bucketed rate limit", () => {
    const features = [
      defineFeature("a", (r) => {
        r.streamHandler("chat:complete", z.object({}), async function* () {}, {
          access: { roles: ["anonymous"] },
          rateLimit: { per: "ip", limit: 10, windowSeconds: 60 },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  describe("additionalRateLimits", () => {
    const emailBucket = [{ per: { payloadField: "email" }, limit: 3, windowSeconds: 86400 }];
    const mailSchema = z.object({ email: z.string() });
    const handlerResult = async () => ({ isSuccess: true as const, data: {} });

    test("throws for an anonymous handler without rateLimit", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            additionalRateLimits: emailBucket,
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/write handler "a:write:request"/);
    });

    test("throws for an anonymous handler with a disabled rateLimit", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { disabled: true, reason: "test" },
            additionalRateLimits: emailBucket,
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/no ip-keyed rateLimit/);
    });

    test("throws for an anonymous handler with a user-bucketed rateLimit", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { per: "tenant", limit: 10, windowSeconds: 60 },
            additionalRateLimits: emailBucket,
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/no ip-keyed rateLimit/);
    });

    test("throws when payloadField is not in the schema", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { per: "ip+handler", limit: 10, windowSeconds: 60 },
            additionalRateLimits: [{ per: { payloadField: "emial" }, limit: 3, windowSeconds: 60 }],
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/payloadField "emial"/);
    });

    test("throws for an empty array and for non-positive limits", () => {
      const withLimits = (additionalRateLimits: typeof emailBucket) => [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { per: "ip", limit: 10, windowSeconds: 60 },
            additionalRateLimits,
          });
        }),
      ];
      expect(() => validateBoot(withLimits([]))).toThrow(/empty array/);
      expect(() =>
        validateBoot(withLimits([{ per: { payloadField: "email" }, limit: 0, windowSeconds: 60 }])),
      ).toThrow(/positive integer/);
    });

    test("accepts an anonymous handler with an ip-keyed rateLimit and a schema field", () => {
      const features = [
        defineFeature("a", (r) => {
          r.writeHandler({
            name: "request",
            schema: mailSchema,
            handler: handlerResult,
            access: { roles: ["anonymous"] },
            rateLimit: { per: "ip+handler", limit: 10, windowSeconds: 60 },
            additionalRateLimits: emailBucket,
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });
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
                allowPlaintext: "test fixture value, not personal data",
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
                allowPlaintext: "test fixture value, not personal data",
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
                allowPlaintext: "test fixture value, not personal data",
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
          r.claimKey("teamId", { type: "string" });
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
          r.claimKey("teamId", { type: "string" });
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
          r.claimKey("teamId", { type: "string" });
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

  // --- MultiStreamProjection delivery invariant ---

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
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({ options: ["a", "b", "c"] as const }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("rejects multiSelect with empty options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                // Cast over the empty-array hole — the factory's generic
                // `as const` widens to `readonly never[]` for `[]`, which
                // is what we want to test against. The validator catches
                // it at boot.
                tags: createMultiSelectField({ options: [] as readonly string[] }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/empty options/);
    });

    test("rejects default value not in options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
                  default: ["c"] as any,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/not a valid option/);
    });

    test("accepts default that is a subset of options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b", "c"] as const,
                  default: ["a", "c"],
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("accepts display: checkboxes with columns and maxRows", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b", "c"] as const,
                  display: "checkboxes",
                  columns: 2,
                  maxRows: 3,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test.each([0, 5])("rejects display: checkboxes with columns %p outside 1-4", (columns) => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  display: "checkboxes",
                  // @cast-boundary test — simulates JS/JSON input outside the 1|2|3|4 union
                  columns: columns as never,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        new RegExp(`invalid columns "${columns}" — must be 1, 2, 3, 4`),
      );
    });

    test("rejects columns without display: checkboxes", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({ options: ["a", "b"] as const, columns: 2 }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/columns.*display.*checkboxes/);
    });

    test("rejects columns when display is explicitly dropdown", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  display: "dropdown",
                  columns: 2,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/columns.*display.*checkboxes/);
    });

    test("rejects maxRows without display: checkboxes", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({ options: ["a", "b"] as const, maxRows: 3 }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/maxRows.*display.*checkboxes/);
    });

    test("rejects maxRows below 1", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  display: "checkboxes",
                  maxRows: 0,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/invalid maxRows/);
    });

    test("rejects non-integer maxRows", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  display: "checkboxes",
                  maxRows: 1.5,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/invalid maxRows/);
    });
  });

  describe("image variants", () => {
    test("accepts a valid variant spec", () => {
      process.env["FILE_STORAGE_PROVIDER"] = "local";
      try {
        const features = [
          defineFeature("profile", (r) => {
            r.entity({
              name: "person",
              ...createEntity({
                fields: {
                  avatar: createImageField({
                    variants: {
                      profile: { fit: "cover", size: { width: 512, height: 512 }, format: "webp" },
                    },
                  }),
                },
              }),
            });
          }),
        ];
        expect(() => validateBoot(features)).not.toThrow();
      } finally {
        delete process.env["FILE_STORAGE_PROVIDER"];
      }
    });

    test("accepts a variant with only `format` — the legitimate format-only case, no size/maxEdge required", () => {
      process.env["FILE_STORAGE_PROVIDER"] = "local";
      try {
        const features = [
          defineFeature("profile", (r) => {
            r.entity({
              name: "person",
              ...createEntity({
                fields: {
                  avatar: createImageField({ variants: { web: { format: "webp" } } }),
                },
              }),
            });
          }),
        ];
        expect(() => validateBoot(features)).not.toThrow();
      } finally {
        delete process.env["FILE_STORAGE_PROVIDER"];
      }
    });

    test("rejects a variant setting both `size` and `maxEdge`", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({
                  variants: {
                    both: { size: { width: 100, height: 100 }, maxEdge: 200 },
                  },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/both/);
    });

    test("rejects a variant name containing a slash", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { "a/b": { maxEdge: 200 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/must match/);
    });

    test("rejects maxEdge: 0", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { thumb: { maxEdge: 0 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/maxEdge/);
    });

    test("rejects quality: 101", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { thumb: { maxEdge: 200, quality: 101 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/quality/);
    });

    test("the same validation applies to `images` (multi) fields", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                gallery: createImagesField({ variants: { "a/b": { maxEdge: 200 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/must match/);
    });

    test("rejects size beyond the max variant edge", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({
                  variants: { huge: { size: { width: 100000, height: 100000 } } },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/size/);
    });

    test("rejects maxEdge beyond the max variant edge", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { huge: { maxEdge: 100000 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/maxEdge/);
    });

    test("rejects a negative blur", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { thumb: { maxEdge: 200, blur: -5 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/blur/);
    });

    test("rejects a blur far beyond the renderer's supported sigma", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({
                  variants: { thumb: { maxEdge: 200, blur: 100000 } },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/blur/);
    });

    test("accepts a valid blur", () => {
      process.env["FILE_STORAGE_PROVIDER"] = "local";
      try {
        const features = [
          defineFeature("profile", (r) => {
            r.entity({
              name: "person",
              ...createEntity({
                fields: {
                  avatar: createImageField({ variants: { thumb: { maxEdge: 200, blur: 8 } } }),
                },
              }),
            });
          }),
        ];
        expect(() => validateBoot(features)).not.toThrow();
      } finally {
        delete process.env["FILE_STORAGE_PROVIDER"];
      }
    });

    test("rejects a blurRegion that overflows the unit square", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({
                  variants: {
                    thumb: {
                      maxEdge: 200,
                      blurRegions: [{ x: -0.3, y: 0, width: 0.99, height: 0 }],
                    },
                  },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/blurRegions/);
    });

    test("accepts a valid blurRegion", () => {
      process.env["FILE_STORAGE_PROVIDER"] = "local";
      try {
        const features = [
          defineFeature("profile", (r) => {
            r.entity({
              name: "person",
              ...createEntity({
                fields: {
                  avatar: createImageField({
                    variants: {
                      thumb: {
                        maxEdge: 200,
                        blurRegions: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
                      },
                    },
                  }),
                },
              }),
            });
          }),
        ];
        expect(() => validateBoot(features)).not.toThrow();
      } finally {
        delete process.env["FILE_STORAGE_PROVIDER"];
      }
    });
  });

  // --- entityList column-renderer form check ---
  // The validator accepts `{ react: { __component: "Name" } }` for a
  // PlatformComponent resolved through the client-side registry and validates it
  // structurally. null/undefined, native-only, and other forms remain opaque.
  // Function renderers are rejected by `action-wiring.ts` because
  // JSON.stringify drops them, causing a silent client-side no-op.
  describe("entityList column renderer form", () => {
    function shopFeature(renderer: unknown) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          // The renderer is intentionally `unknown`: these tests also cover forms that
          // correctly authored TypeScript would reject, such as an empty `__component`
          // or a number.
          // kumiko-lint-ignore as-cast renderer is a test fixture for invalid forms
          columns: [{ field: "name", renderer: renderer as never }],
        });
      });
    }

    test("function-renderer → throws (Function is discarded by JSON.stringify)", () => {
      expect(() => validateBoot([shopFeature((v: unknown) => String(v))])).toThrow(
        /column "name" renderer is a function/,
      );
    });

    test("undefined renderer → no throw (column without renderer)", () => {
      expect(() => validateBoot([shopFeature(undefined)])).not.toThrow();
    });

    test("null renderer → no throw (skip)", () => {
      expect(() => validateBoot([shopFeature(null)])).not.toThrow();
    });

    test("object without react branch → no throw (e.g. native-only)", () => {
      expect(() => validateBoot([shopFeature({ native: { __component: "X" } })])).not.toThrow();
    });

    test("react branch is non-object → throws with a clear message", () => {
      expect(() => validateBoot([shopFeature({ react: 42 })])).toThrow(/non-object `react` branch/);
    });

    test("react branch without __component key → no throw (skip)", () => {
      // {} and { __component: undefined } are not the string-keyed form under test.
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

    test("react.__component non-empty string → no throw (valid form)", () => {
      expect(() =>
        validateBoot([shopFeature({ react: { __component: "ColorSwatch" } })]),
      ).not.toThrow();
    });
  });

  // --- function-renderer check on the non-entityEdit/entityList screen
  // types that share the same EditLayout/ListColumnSpec shapes
  // (action-wiring.ts's validateEditLayoutNoFunctions/validateColumnsNoFunctions) ---
  describe("function-renderer check on other EditLayout/columns screens", () => {
    test("actionForm field renderer as a function → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.screen({
            id: "restock",
            type: "actionForm",
            handler: "shop:write:restock",
            fields: { qty: { type: "number" } } as never,
            layout: {
              sections: [
                { fields: [{ field: "qty", renderer: (v: unknown) => String(v) }] as never },
              ],
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /\(actionForm\) field "qty" renderer is a function/,
      );
    });

    test("configEdit field renderer as a function → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.config({
            keys: { "site-name": createTenantConfig("text", { default: "" }) },
          });
          r.screen({
            id: "settings",
            type: "configEdit",
            scope: "tenant",
            configKeys: { siteName: "shop:config:site-name" },
            fields: { siteName: { type: "text" } } as never,
            layout: {
              sections: [
                {
                  fields: [{ field: "siteName", renderer: (v: unknown) => String(v) }] as never,
                },
              ],
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /\(configEdit\) field "siteName" renderer is a function/,
      );
    });

    test("projectionDetail field renderer as a function → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.screen({
            id: "order-detail",
            type: "projectionDetail",
            query: "shop:query:order-detail",
            layout: {
              sections: [
                { fields: [{ field: "total", renderer: (v: unknown) => String(v) }] as never },
              ],
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /\(projectionDetail\) field "total" renderer is a function/,
      );
    });

    test("dashboard list-panel column renderer as a function → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.screen({
            id: "overview",
            type: "dashboard",
            panels: [
              {
                kind: "list",
                id: "recent-orders",
                label: "Recent Orders",
                query: "shop:query:recent-orders",
                columns: [{ field: "total", renderer: (v: unknown) => String(v) }] as never,
              },
            ],
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /\(dashboard-list\) column "total" renderer is a function/,
      );
    });
  });

  // --- entityList virtual (labeled) columns ---
  // A column whose `field` is not an entity field is allowed IF it carries a
  // `label` — a presentational column drawn by a columnRenderer component (e.g.
  // tag chips). Without a label an unknown field stays a boot error (typo guard).
  describe("entityList virtual labeled column", () => {
    function noteFeature(column: unknown) {
      return defineFeature("notes", (r) => {
        r.entity({
          name: "note",
          ...createEntity({
            fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "note-list",
          type: "entityList",
          entity: "note",
          // kumiko-lint-ignore as-cast test fixture pins valid + invalid column forms
          columns: ["title", column as never],
        });
      });
    }

    test("labeled component column on a non-field → no throw", () => {
      expect(() =>
        validateBoot([
          noteFeature({
            field: "tags",
            label: "Tags",
            renderer: { react: { __component: "TagsCell" } },
          }),
        ]),
      ).not.toThrow();
    });

    test("unlabeled column on a non-field → Throw (unknown field)", () => {
      expect(() =>
        validateBoot([
          noteFeature({ field: "tags", renderer: { react: { __component: "TagsCell" } } }),
        ]),
      ).toThrow(/tags/);
    });

    test("labeled column on a non-field WITHOUT a renderer → Throw (label alone isn't enough)", () => {
      // Regression (697/1): renderer is what actually draws a virtual column —
      // a label with no renderer would push an empty, unrendered column into
      // the view model instead of a real typo-guard.
      expect(() => validateBoot([noteFeature({ field: "tags", label: "Tags" })])).toThrow(/tags/);
    });
  });

  // --- entityList: row-meta columns (id/tenantId/version/...) ---
  // Row-meta columns are real base-table columns, never declared entity
  // fields — a SystemAdmin cross-tenant list exposes tenantId this way.
  //
  // Two separate boot-validators check entityList columns (validateScreens
  // here, validateEntityListScreens in entity-list-screens.ts) — a review
  // found they'd drifted to accept different column sets, which
  // would have let a softDelete column pass one gate and throw only in
  // computeListViewModel at render time. Table-driven over
  // LIST_ROW_META_COLUMNS (not one-off cases) so a future column added
  // there is proven against BOTH validators automatically. Companion
  // assertions: list.test.ts (headless renderer draws the same set) and
  // list-row-meta-drift.test.ts (LIST_ROW_META_COLUMNS key-set drift guard).
  describe("entityList row-meta column — accepted by both boot validators", () => {
    for (const softDelete of [false, true]) {
      for (const [columnName, columnType] of Object.entries(LIST_ROW_META_COLUMNS)) {
        test(`"${columnName}" (${columnType}) on a ${softDelete ? "softDelete" : "non-softDelete"} entity → no throw`, () => {
          const feature = noteFeatureWithColumn(columnName, { softDelete });
          expect(() => validateBoot([feature])).not.toThrow();
          const fixed = withBootValidatorFixture([feature]);
          expect(() => validateEntityListScreens(fixed)).not.toThrow();
        });
      }
    }

    // rowMetaFieldNames(true) also carries the softDelete-only columns
    // (isDeleted/deletedAt/deletedById) — real base-table columns, but
    // deliberately absent from LIST_ROW_META_COLUMNS because
    // computeListViewModel can't render them. Both validators must reject
    // them, or a softDelete column would pass boot and only throw at
    // render-time.
    const softDeleteOnlyColumns = [...rowMetaFieldNames(true)].filter(
      (name) => LIST_ROW_META_COLUMNS[name] === undefined,
    );
    test("softDelete-only row-meta set is exactly isDeleted/deletedAt/deletedById", () => {
      expect([...softDeleteOnlyColumns].sort()).toEqual(["deletedAt", "deletedById", "isDeleted"]);
    });

    for (const columnName of softDeleteOnlyColumns) {
      test(`"${columnName}" (softDelete-only, not renderable) → Throw on both validators`, () => {
        const feature = noteFeatureWithColumn(columnName, { softDelete: true });
        expect(() => validateBoot([feature])).toThrow(
          new RegExp(`references field "${columnName}" which does not exist`),
        );
        const fixed = withBootValidatorFixture([feature]);
        expect(() => validateEntityListScreens(fixed)).toThrow(
          new RegExp(`unknown column field "${columnName}"`),
        );
      });
    }
  });

  // --- entityList: typo columns must still fail (row-meta acceptance is
  // NOT a general gate-loosening) ---
  //
  // validateBoot only ever surfaces validateScreens' message here — it runs
  // before validateEntityListScreens in the per-feature loop (see
  // boot-validator/index.ts) and throws first. validateEntityListScreens'
  // own "unknown column field" message is only reachable by calling it
  // directly, which these tests also do.
  describe("entityList typo column → Throw on both validators (not silently accepted)", () => {
    const typoColumns = ["tenantID", "tenatId", "totallyMadeUp"];

    for (const typo of typoColumns) {
      test(`"${typo}" fails validateScreens (via validateBoot)`, () => {
        const feature = noteFeatureWithColumn(typo);
        expect(() => validateBoot([feature])).toThrow(
          new RegExp(`references field "${typo}" which does not exist`),
        );
      });

      test(`"${typo}" fails validateEntityListScreens directly ("unknown column field")`, () => {
        const feature = noteFeatureWithColumn(typo);
        const fixed = withBootValidatorFixture([feature]);
        expect(() => validateEntityListScreens(fixed)).toThrow(
          new RegExp(`unknown column field "${typo}"`),
        );
      });
    }
  });

  // --- entityList: pagination + sort validation ---
  // Catch authoring errors before production so screens that fail to load, sort
  // incorrectly, or crash when paging are rejected at boot. These tests cover
  // server-side validation only; pager rendering belongs to the renderer.
  describe("entityList pagination + sort", () => {
    function makeFeature(
      override: Partial<{
        readonly pageSize: number;
        readonly defaultSort: { readonly field: string; readonly dir: "asc" | "desc" };
      }>,
    ) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: {
              name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
              // Intentionally not sortable: verifies that the validator distinguishes it
              // and accepts only sortable fields as `defaultSort` targets.
              description: createTextField({ personal: false, reason: "test_fixture" }),
            },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: [{ field: "name" }],
          ...override,
        });
      });
    }

    test("pageSize: positive → no throw", () => {
      expect(() => validateBoot([makeFeature({ pageSize: 100 })])).not.toThrow();
    });

    test("pageSize: 0 → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature({ pageSize: 0 })])).toThrow(
        /pageSize=0 — must be a positive integer/,
      );
    });

    test("pageSize: negativ → Throw", () => {
      expect(() => validateBoot([makeFeature({ pageSize: -10 })])).toThrow(
        /pageSize=-10 — must be a positive integer/,
      );
    });

    test("defaultSort.field: exists + sortable=true → no throw", () => {
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

  // --- Screen filter ---
  // Three layers of author-code validation: the field exists, `filterable: true`
  // is set, and the operator matches the field type. A boot failure is preferable
  // to a silently empty bucket or a Drizzle crash at runtime.
  describe("entityList screen-filter (Tier 2.7c)", () => {
    function makeFeature(
      filter: {
        readonly field: string;
        readonly op: "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "in";
        readonly value: unknown;
      },
      fields: Record<string, unknown> = {
        name: {
          type: "text",
          allowPlaintext: "test fixture value, not personal data",
          sortable: true,
          filterable: true,
        },
        status: {
          type: "text",
          allowPlaintext: "test fixture value, not personal data",
          filterable: true,
        },
        secret: { type: "text", allowPlaintext: "test fixture value, not personal data" },
      },
    ) {
      return defineFeature("shop", (r) => {
        r.entity({ name: "product", fields: fields as never });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: [{ field: "name" }],
          filter,
        });
      });
    }

    test("filter.field exists + filterable → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ field: "status", op: "eq", value: "active" })]),
      ).not.toThrow();
    });

    test("filter.field does not exist → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature({ field: "ghost", op: "eq", value: "x" })])).toThrow(
        /filter references unknown field "ghost"/,
      );
    });

    test("filter.field existiert aber filterable=false → Throw", () => {
      expect(() => validateBoot([makeFeature({ field: "secret", op: "eq", value: "x" })])).toThrow(
        /filter references field "secret" which is not filterable/,
      );
    });

    test("filter on a personal field → throws; the list handler rejects it at runtime", () => {
      const fields = {
        name: {
          type: "text",
          allowPlaintext: "test fixture value, not personal data",
          filterable: true,
        },
        note: {
          type: "text",
          allowPlaintext: "test fixture value, not personal data",
          filterable: true,
          tenantOwned: true,
        },
      };
      expect(() =>
        validateBoot([makeFeature({ field: "note", op: "eq", value: "x" }, fields)]),
      ).toThrow(/filter references field "note" which is encrypted, personal or secret/);
    });

    test("eq filter on a personal field with a blind index → no throw; other ops → throw", () => {
      const fields = {
        name: {
          type: "text",
          allowPlaintext: "test fixture value, not personal data",
          filterable: true,
        },
        mail: {
          type: "text",
          allowPlaintext: "test fixture value, not personal data",
          filterable: true,
          tenantOwned: true,
          lookupable: true,
        },
      };
      expect(() =>
        validateBoot([makeFeature({ field: "mail", op: "eq", value: "a@example.com" }, fields)]),
      ).not.toThrow();
      expect(() =>
        validateBoot([makeFeature({ field: "mail", op: "in", value: ["a@example.com"] }, fields)]),
      ).toThrow(/filter references field "mail" which is encrypted, personal or secret/);
    });

    test("filter.op=lt auf text-Feld → Throw (op-vs-Type-Compat)", () => {
      expect(() => validateBoot([makeFeature({ field: "status", op: "lt", value: "x" })])).toThrow(
        /filter\.op "lt" is not allowed on field "status" \(type "text"\)/,
      );
    });

    test("filter.op=gt on a number field → no throw (comparable)", () => {
      expect(() =>
        validateBoot([
          makeFeature(
            { field: "rank", op: "gt", value: 5 },
            {
              name: {
                type: "text",
                allowPlaintext: "test fixture value, not personal data",
                filterable: true,
              },
              rank: { type: "number", filterable: true },
            },
          ),
        ]),
      ).not.toThrow();
    });

    test("filter.op=lte/gte on a number field → no throw (comparable)", () => {
      const fields = {
        name: {
          type: "text",
          allowPlaintext: "test fixture value, not personal data",
          filterable: true,
        },
        rank: { type: "number", filterable: true },
      };
      expect(() =>
        validateBoot([makeFeature({ field: "rank", op: "lte", value: 5 }, fields)]),
      ).not.toThrow();
      expect(() =>
        validateBoot([makeFeature({ field: "rank", op: "gte", value: 5 }, fields)]),
      ).not.toThrow();
    });

    test("filter.op=lte auf text-Feld → Throw (op-vs-Type-Compat)", () => {
      expect(() => validateBoot([makeFeature({ field: "status", op: "lte", value: "x" })])).toThrow(
        /filter\.op "lte" is not allowed on field "status" \(type "text"\)/,
      );
    });

    test('filter.op="in" with a non-array value → throws', () => {
      expect(() =>
        validateBoot([makeFeature({ field: "status", op: "in", value: "active" })]),
      ).toThrow(/filter\.op "in" requires filter\.value to be a readonly array/);
    });

    test('filter.op="in" with an array → no throw', () => {
      expect(() =>
        validateBoot([makeFeature({ field: "status", op: "in", value: ["active", "pending"] })]),
      ).not.toThrow();
    });

    test("filter.op=ne on a boolean → no throw; lt on a boolean → throws", () => {
      const fields = {
        name: {
          type: "text",
          allowPlaintext: "test fixture value, not personal data",
          filterable: true,
        },
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

  // --- actionForm screen ---
  // A non-CRUD write-handler-backed form. Boot checks that the handler is
  // non-empty and registered, fields are non-empty and typed, the layout is
  // consistent, and any redirect targets a registered screen.
  describe("actionForm screen (Tier 2.7d)", () => {
    type ActionFormOverride = {
      readonly handler?: string | undefined;
      readonly fields?: Record<string, unknown>;
      readonly sections?: ReadonlyArray<{
        readonly title: string;
        readonly fields?: ReadonlyArray<string | Record<string, unknown>>;
        readonly groups?: ReadonlyArray<{
          readonly title: string;
          readonly fields: readonly string[];
        }>;
      }>;
      readonly queries?: readonly string[];
      readonly redirect?: string | { readonly screen: string; readonly idFrom: string };
      readonly successLinks?: ReadonlyArray<{
        readonly screen: string;
        readonly idFrom?: string;
        readonly label: string;
      }>;
      readonly successFacts?: ReadonlyArray<{ readonly field: string; readonly label: string }>;
      readonly cancelTarget?: string | false;
      readonly extraScreens?: readonly string[];
      readonly extraDetailScreens?: readonly string[];
      readonly mode?: "single" | "wizard";
      readonly draft?: boolean;
    };

    // Sets up a test entity and write handler so the form can register at boot
    // without custom code. Additional screens can be added for redirect tests.
    function makeFeature(override: ActionFormOverride = {}) {
      const handler = override.handler ?? "shop:write:invoice:approve";
      const fields = override.fields ?? {
        note: { type: "text" },
        priority: { type: "number" },
      };
      const sections = override.sections ?? [{ title: "Approval", fields: ["note", "priority"] }];
      return defineFeature("shop", (r) => {
        // Registers the write handler referenced by the action form. A direct stub is
        // used instead of `defineEntityWriteHandler`, which requires an existing entity.
        r.writeHandler({
          name: "invoice:approve",
          schema: { _type: "stub" } as never,
          handler: async () => ({ isSuccess: true, data: {} }) as never,
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        for (const query of override.queries ?? []) {
          r.queryHandler({
            name: query,
            schema: z.object({}),
            handler: async () => ({}),
            access: { roles: ["Admin"] },
          });
        }
        r.screen({
          id: "approve-invoice",
          type: "actionForm",
          handler,
          fields: fields as never,
          layout: {
            sections: sections as never,
            ...(override.mode !== undefined && { mode: override.mode }),
            ...(override.draft !== undefined && { draft: override.draft }),
          },
          ...(override.redirect !== undefined && { redirect: override.redirect }),
          ...(override.successLinks !== undefined && { successLinks: override.successLinks }),
          ...(override.successFacts !== undefined && { successFacts: override.successFacts }),
          ...(override.cancelTarget !== undefined && { cancelTarget: override.cancelTarget }),
        });
        for (const extra of override.extraScreens ?? []) {
          r.screen({
            id: extra,
            type: "custom",
            renderer: { react: "stub" },
          });
        }
        if (override.extraDetailScreens?.length) {
          r.queryHandler({
            name: "order:detail",
            schema: z.object({}),
            handler: async () => [],
            access: { roles: ["Admin"] },
          });
        }
        for (const extra of override.extraDetailScreens ?? []) {
          r.screen({
            id: extra,
            type: "projectionDetail",
            query: "shop:query:order:detail",
            layout: { sections: [{ title: "s", fields: ["total"] }] },
          });
        }
      });
    }

    test("happy path: handler + fields + layout consistent → no throw", () => {
      expect(() => validateBoot([makeFeature()])).not.toThrow();
    });

    test("handler not registered as a write-handler → throws with a hint", () => {
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

    test("field without a type discriminator → throws", () => {
      expect(() => validateBoot([makeFeature({ fields: { note: { required: true } } })])).toThrow(
        /field "note" has no `type` set/,
      );
    });

    // An actionForm has no entity, so a money field there can't
    // inherit entity.defaultCurrency — undeclared, the renderer seeds a bare
    // `0` and the handler's zod schema rejects the submit.
    describe("money field currency source", () => {
      const moneyForm = (currency?: unknown) =>
        makeFeature({
          fields: { amount: { type: "money", ...(currency !== undefined && { currency }) } },
          sections: [{ title: "Payment", fields: ["amount"] }],
        });

      test("money field without currency → throws, naming the screen and field", () => {
        expect(() => validateBoot([moneyForm()])).toThrow(
          /Screen "approve-invoice" \(actionForm\) money field "amount" must declare where its currency comes from/,
        );
      });

      test("error message names both valid forms verbatim", () => {
        expect(() => validateBoot([moneyForm()])).toThrow(
          /currency: \{ kind: "literal", code: "EUR" \}[\s\S]*currency: \{ kind: "tenant" \}/,
        );
      });

      test("currency: { kind: 'literal', code } → no throw", () => {
        expect(() => validateBoot([moneyForm({ kind: "literal", code: "EUR" })])).not.toThrow();
      });

      test("currency: { kind: 'tenant' } → no throw", () => {
        expect(() => validateBoot([moneyForm({ kind: "tenant" })])).not.toThrow();
      });

      test("literal with an empty code → throws", () => {
        expect(() => validateBoot([moneyForm({ kind: "literal", code: "  " })])).toThrow(
          /empty or non-string `code`/,
        );
      });

      test("unbekannter kind → Throw", () => {
        expect(() => validateBoot([moneyForm({ kind: "entityDefault" })])).toThrow(
          /unknown currency kind "entityDefault"/,
        );
      });

      test("non-money fields remain unchanged", () => {
        expect(() => validateBoot([makeFeature()])).not.toThrow();
      });

      // The check sits in validateFormFieldsMap, the walk actionForm,
      // secretMint and secretMint's confirm step all share.
      function mintFeature(
        fields: Record<string, unknown>,
        confirmFields?: Record<string, unknown>,
      ) {
        return defineFeature("shop", (r) => {
          r.writeHandler({
            name: "token:mint",
            schema: { _type: "stub" } as never,
            handler: async () => ({ isSuccess: true, data: {} }) as never,
            access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
          });
          r.screen({
            id: "mint-token",
            type: "secretMint",
            handler: "shop:write:token:mint",
            fields: fields as never,
            layout: { sections: [{ title: "Mint", fields: Object.keys(fields) }] as never },
            reveal: { fields: [{ field: "token", label: "Token" }] },
            ...(confirmFields !== undefined && {
              confirm: {
                handler: "shop:write:token:mint",
                fields: confirmFields as never,
                layout: {
                  sections: [{ title: "Confirm", fields: Object.keys(confirmFields) }] as never,
                },
              },
            }),
          });
        });
      }

      test("secretMint money field without currency → throws", () => {
        expect(() => validateBoot([mintFeature({ fee: { type: "money" } })])).toThrow(
          /Screen "mint-token" \(secretMint\) money field "fee" must declare where its currency comes from/,
        );
      });

      test("secretMint confirm-step money field without currency → throws", () => {
        expect(() =>
          validateBoot([
            mintFeature(
              { fee: { type: "money", currency: { kind: "literal", code: "EUR" } } },
              { topUp: { type: "money" } },
            ),
          ]),
        ).toThrow(
          /Screen "mint-token" \(secretMint confirm\) money field "topUp" must declare where its currency comes from/,
        );
      });

      test("secretMint with declared sources in both steps → no throw", () => {
        expect(() =>
          validateBoot([
            mintFeature(
              { fee: { type: "money", currency: { kind: "literal", code: "EUR" } } },
              { topUp: { type: "money", currency: { kind: "tenant" } } },
            ),
          ]),
        ).not.toThrow();
      });
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

    test("section with empty groups → throws (empty card)", () => {
      expect(() =>
        validateBoot([makeFeature({ sections: [{ title: "Empty", groups: [] }] })]),
      ).toThrow(/section "Empty" with zero fields/);
    });

    test.each([
      ["fields: []", []],
      ["non-empty fields", ["name"]],
    ])(
      "section with %s alongside groups → throws; migration names fields: []",
      (_label, fields) => {
        expect(() =>
          validateBoot([
            makeFeature({
              sections: [{ title: "Both", fields, groups: [{ title: "G", fields: ["name"] }] }],
            }),
          ]),
        ).toThrow(/section "Both" declares both fields and groups — remove `fields: \[\]`/);
      },
    );

    test("layout referenziert unknown field → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ sections: [{ title: "x", fields: ["ghost"] }] })]),
      ).toThrow(/layout references unknown field "ghost"/);
    });

    test("section with fields AND groups → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            sections: [
              {
                title: "Approval",
                fields: ["note"],
                groups: [{ title: "Priority", fields: ["priority"] }],
              },
            ],
          }),
        ]),
      ).toThrow(/declares both fields and groups/);
    });

    test("group referenziert unknown field → Throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            sections: [{ title: "Approval", groups: [{ title: "Priority", fields: ["ghost"] }] }],
          }),
        ]),
      ).toThrow(/layout references unknown field "ghost"/);
    });

    test("valid groups → no throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            sections: [
              {
                title: "Approval",
                groups: [
                  { title: "Basics", fields: ["note"] },
                  { title: "Priority", fields: ["priority"] },
                ],
              },
            ],
          }),
        ]),
      ).not.toThrow();
    });

    test("redirect → existing screen-id in the same feature → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ redirect: "after-form", extraScreens: ["after-form"] })]),
      ).not.toThrow();
    });

    test("redirect → unknown screen-id → Throw", () => {
      expect(() => validateBoot([makeFeature({ redirect: "ghost-screen" })])).toThrow(
        /redirect "ghost-screen" does not resolve to a registered screen/,
      );
    });

    // --- redirect object form with idFrom ---
    test("redirect object → existing id-carrying screen → no throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            redirect: { screen: "after-form", idFrom: "leaseId" },
            extraDetailScreens: ["after-form"],
          }),
        ]),
      ).not.toThrow();
    });

    test("redirect object with idFrom → screen without an ID (custom) → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            redirect: { screen: "after-form", idFrom: "leaseId" },
            extraScreens: ["after-form"],
          }),
        ]),
      ).toThrow(/redirect\.idFrom is set but target screen "after-form" \(custom\) carries no id/);
    });

    test("redirect object → unknown screen-id → throws (unwrap does not bypass validation)", () => {
      expect(() =>
        validateBoot([makeFeature({ redirect: { screen: "ghost-screen", idFrom: "leaseId" } })]),
      ).toThrow(/redirect "ghost-screen" does not resolve to a registered screen/);
    });

    test("redirect object with an empty idFrom → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            redirect: { screen: "after-form", idFrom: "  " },
            extraScreens: ["after-form"],
          }),
        ]),
      ).toThrow(/redirect\.idFrom is empty/);
    });

    test("redirect object with an idFrom containing whitespace → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            redirect: { screen: "after-form", idFrom: " leaseId" },
            extraScreens: ["after-form"],
          }),
        ]),
      ).toThrow(/redirect\.idFrom " leaseId" has leading\/trailing whitespace/);
    });

    // --- successLinks ---
    test("successLinks → existing screens → no throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            successLinks: [
              { screen: "after-form", idFrom: "leaseId", label: "shop.link.lease" },
              { screen: "other-form", idFrom: "id", label: "shop.link.other" },
            ],
            extraDetailScreens: ["after-form", "other-form"],
          }),
        ]),
      ).not.toThrow();
    });

    test("successLinks together with redirect → Throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            redirect: "overview",
            successLinks: [{ screen: "overview", idFrom: "id", label: "shop.link.overview" }],
            extraScreens: ["overview"],
          }),
        ]),
      ).toThrow(/sets both redirect and successLinks/);
    });

    test("successFacts together with redirect → Throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            redirect: "overview",
            successFacts: [{ field: "count", label: "shop.fact.count" }],
            extraScreens: ["overview"],
          }),
        ]),
      ).toThrow(/sets both redirect and successFacts/);
    });

    test("successLinks → unknown screen → Throw naming the link", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            successLinks: [{ screen: "ghost-screen", idFrom: "id", label: "shop.link.ghost" }],
          }),
        ]),
      ).toThrow(/successLinks\[0\] "ghost-screen" does not resolve to a registered screen/);
    });

    test("successLinks idFrom on a screen without id → Throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            successLinks: [{ screen: "overview", idFrom: "leaseId", label: "shop.link.overview" }],
            extraScreens: ["overview"],
          }),
        ]),
      ).toThrow(/successLinks\[0\]\.idFrom is set but target screen "overview" \(custom\)/);
    });

    test("successLinks without idFrom → screen that carries no id → no throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            successLinks: [{ screen: "overview", label: "shop.link.overview" }],
            extraScreens: ["overview"],
          }),
        ]),
      ).not.toThrow();
    });

    test("successLinks without idFrom → record screen → Throw naming the link", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            successLinks: [{ screen: "after-form", label: "shop.link.lease" }],
            extraDetailScreens: ["after-form"],
          }),
        ]),
      ).toThrow(/successLinks\[0\] targets "after-form" \(projectionDetail\), a record screen/);
    });

    test("successLinks without idFrom → unknown screen → Throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({ successLinks: [{ screen: "ghost-screen", label: "shop.link.ghost" }] }),
        ]),
      ).toThrow(/successLinks\[0\] "ghost-screen" does not resolve to a registered screen/);
    });

    // --- field prefix / suffix / fillAction ---
    const fillSections = (field: Record<string, unknown>) => [
      { title: "Approval", fields: [{ field: "note", ...field }, "priority"] },
    ];
    const fillAction = {
      label: "shop.fill.roll",
      query: "shop:query:suggest-note",
      field: "suggestion",
    };

    test("fillAction with a registered query, form-field affix and pick params → no throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            queries: ["suggest-note"],
            sections: fillSections({
              prefix: "https://",
              suffix: { field: "priority" },
              fillAction: { ...fillAction, params: { pick: ["priority"] } },
            }),
          }),
        ]),
      ).not.toThrow();
    });

    test("fillAction → unregistered query → Throw naming the field", () => {
      expect(() => validateBoot([makeFeature({ sections: fillSections({ fillAction }) })])).toThrow(
        /Screen "approve-invoice" \(actionForm\) field "note" fillAction query "shop:query:suggest-note" is not a registered query-handler/,
      );
    });

    test("suffix { field } naming a field outside the form → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ sections: fillSections({ suffix: { field: "ghost" } }) })]),
      ).toThrow(/field "note" suffix references unknown field "ghost"/);
    });

    test("prefix { field } naming a field outside the form → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ sections: fillSections({ prefix: { field: "ghost" } }) })]),
      ).toThrow(/field "note" prefix references unknown field "ghost"/);
    });

    test("fillAction params reading a field outside the form (pick and map) → Throw", () => {
      for (const params of [{ pick: ["ghost"] }, { map: { to: "ghost" } }]) {
        expect(() =>
          validateBoot([
            makeFeature({
              queries: ["suggest-note"],
              sections: fillSections({ fillAction: { ...fillAction, params } }),
            }),
          ]),
        ).toThrow(/fillAction\.params reads unknown field "ghost"/);
      }
    });

    test.each([
      [
        "a password field",
        { type: "text", format: "password" },
        /sensitive, writeOnly or password/,
      ],
      ["a sensitive field", { type: "text", sensitive: true }, /sensitive, writeOnly or password/],
      [
        "a boolean field",
        { type: "boolean" },
        /fillAction needs a text, number, decimal, bigInt field/,
      ],
    ])("fillAction on %s → Throw", (_name, noteField, message) => {
      expect(() =>
        validateBoot([
          makeFeature({
            queries: ["suggest-note"],
            fields: { note: noteField, priority: { type: "number" } },
            sections: fillSections({ fillAction }),
          }),
        ]),
      ).toThrow(message);
    });

    test("fillAction on a number field → no throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            queries: ["suggest-note"],
            fields: { note: { type: "number" }, priority: { type: "number" } },
            sections: fillSections({ fillAction }),
          }),
        ]),
      ).not.toThrow();
    });

    test("cancelTarget → existing screen-id → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ cancelTarget: "after-form", extraScreens: ["after-form"] })]),
      ).not.toThrow();
    });

    test("cancelTarget → unknown screen-id → Throw", () => {
      expect(() => validateBoot([makeFeature({ cancelTarget: "ghost-screen" })])).toThrow(
        /cancelTarget "ghost-screen" does not resolve to a registered screen/,
      );
    });

    test("cancelTarget=false (button disabled) → no throw", () => {
      expect(() => validateBoot([makeFeature({ cancelTarget: false })])).not.toThrow();
    });

    // --- redirect/cancelTarget: cross-feature QN ---
    test("redirect → fully qualified cross-feature QN → no throw", () => {
      const consumer = defineFeature("statements", (r) => {
        r.screen({ id: "statement-upload-list", type: "custom", renderer: { react: "stub" } });
      });
      expect(() =>
        validateBoot([
          makeFeature({ redirect: "statements:screen:statement-upload-list" }),
          consumer,
        ]),
      ).not.toThrow();
    });

    test("redirect → unbekannte Cross-Feature-QN → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ redirect: "statements:screen:ghost-screen" })]),
      ).toThrow(
        /redirect "statements:screen:ghost-screen" does not resolve to a registered screen/,
      );
    });

    test("cancelTarget → fully qualified cross-feature QN → no throw", () => {
      const consumer = defineFeature("statements", (r) => {
        r.screen({ id: "statement-upload-list", type: "custom", renderer: { react: "stub" } });
      });
      expect(() =>
        validateBoot([
          makeFeature({ cancelTarget: "statements:screen:statement-upload-list" }),
          consumer,
        ]),
      ).not.toThrow();
    });

    test("extension section without a component → throws (parity with entityEdit)", () => {
      // `synthesizeActionFormScreen` passes the layout unchanged to RenderEdit;
      // without a react/native marker, an extension section would render empty
      // without an obvious error.
      const section = { kind: "extension", title: "Custom", component: {} };
      expect(() => validateBoot([makeFeature({ sections: [section] as never })])).toThrow(
        /\(actionForm\) extension section "Custom" has no component/,
      );
    });

    test("extension section with a react component → no throw", () => {
      const section = { kind: "extension", title: "Custom", component: { react: "Panel" } };
      expect(() => validateBoot([makeFeature({ sections: [section] as never })])).not.toThrow();
    });

    test("mode: wizard with only 1 section → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            mode: "wizard",
            sections: [{ title: "Step 1", fields: ["note"] }],
          }),
        ]),
      ).toThrow(/mode: "wizard" but only 1 section\(s\)/);
    });

    test("mode: wizard with a section without a title → throws", () => {
      const sections = [
        { title: "Step 1", fields: ["note"] },
        { title: "", fields: ["priority"] },
      ];
      expect(() => validateBoot([makeFeature({ mode: "wizard", sections })])).toThrow(
        /sections\[1\] has no title/,
      );
    });

    test("mode: wizard with >= 2 titled sections → no throw", () => {
      const sections = [
        { title: "Step 1", fields: ["note"] },
        { title: "Step 2", fields: ["priority"] },
      ];
      expect(() => validateBoot([makeFeature({ mode: "wizard", sections })])).not.toThrow();
    });

    test("draft: true without a mounted form-draft feature → throws", () => {
      const sections = [
        { title: "Step 1", fields: ["note"] },
        { title: "Step 2", fields: ["priority"] },
      ];
      expect(() => validateBoot([makeFeature({ mode: "wizard", sections, draft: true })])).toThrow(
        /"form-draft" is not mounted/,
      );
    });

    test("draft: true with a mounted form-draft feature → no throw", () => {
      const sections = [
        { title: "Step 1", fields: ["note"] },
        { title: "Step 2", fields: ["priority"] },
      ];
      expect(() =>
        validateBoot([
          makeFeature({ mode: "wizard", sections, draft: true }),
          defineFeature("form-draft", () => {}),
        ]),
      ).not.toThrow();
    });

    test("draft: true without mode: 'wizard' → throws", () => {
      expect(() => validateBoot([makeFeature({ draft: true })])).toThrow(/mode is not "wizard"/);
    });

    test("mode omitted (default 'single') keeps the existing layout valid → no throw", () => {
      expect(() => validateBoot([makeFeature()])).not.toThrow();
    });
  });

  // --- secretMint-Screen ---
  // Mint-form → one-time reveal → confirm. Shares its six inline-form checks
  // with actionForm (validateInlineFormScreen), plus its own reveal.fields
  // checks: non-empty, unique `field`, non-empty `label`.
  describe("secretMint screen", () => {
    type SecretMintOverride = {
      readonly handler?: string | undefined;
      readonly fields?: Record<string, unknown>;
      readonly sections?: ReadonlyArray<{
        readonly title: string;
        readonly fields: readonly string[];
      }>;
      readonly reveal?: {
        readonly fields: ReadonlyArray<{
          readonly field: string;
          readonly label: string;
          readonly display?: "code" | "list";
        }>;
      };
      readonly redirect?: string;
      readonly extraScreens?: readonly string[];
      readonly confirm?: {
        readonly handler?: string;
        readonly fields?: Record<string, unknown>;
        readonly sections?: ReadonlyArray<{
          readonly title: string;
          readonly fields: readonly string[];
        }>;
        readonly carry?: readonly string[];
        readonly mode?: "single" | "wizard" | "tabs";
        readonly draft?: boolean;
      };
    };

    function makeFeature(override: SecretMintOverride = {}) {
      const handler = override.handler ?? "shop:write:token:mint";
      const fields = override.fields ?? { label: { type: "text" } };
      const sections = override.sections ?? [{ title: "Mint", fields: ["label"] }];
      const reveal = override.reveal ?? {
        fields: [{ field: "token", label: "shop:screen:mint-token.field:token" }],
      };
      const confirmOverride = override.confirm;
      return defineFeature("shop", (r) => {
        r.writeHandler({
          name: "token:mint",
          schema: { _type: "stub" } as never,
          handler: async () => ({ isSuccess: true, data: {} }) as never,
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        if (confirmOverride !== undefined) {
          r.writeHandler({
            name: "token:confirm",
            schema: { _type: "stub" } as never,
            handler: async () => ({ isSuccess: true, data: {} }) as never,
            access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
          });
        }
        r.screen({
          id: "mint-token",
          type: "secretMint",
          handler,
          fields: fields as never,
          layout: { sections: sections as never },
          reveal: reveal as never,
          ...(override.redirect !== undefined && { redirect: override.redirect }),
          ...(confirmOverride !== undefined && {
            confirm: {
              handler: confirmOverride.handler ?? "shop:write:token:confirm",
              fields: (confirmOverride.fields ?? { code: { type: "text" } }) as never,
              layout: {
                sections: (confirmOverride.sections ?? [
                  { title: "Confirm", fields: ["code"] },
                ]) as never,
                ...(confirmOverride.mode !== undefined && { mode: confirmOverride.mode }),
                ...(confirmOverride.draft !== undefined && { draft: confirmOverride.draft }),
              },
              ...(confirmOverride.carry !== undefined && { carry: confirmOverride.carry }),
            },
          }),
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

    test("happy path: handler + fields + layout + reveal consistent → no throw", () => {
      expect(() => validateBoot([makeFeature()])).not.toThrow();
    });

    test("handler not registered as a write-handler → throws", () => {
      expect(() => validateBoot([makeFeature({ handler: "shop:query:token:list" })])).toThrow(
        /\(secretMint\) handler "shop:query:token:list" is not a registered write-handler/,
      );
    });

    // secretMint allows an empty fields map (input-less mint) — but
    // the default `sections` still references "label", which no longer
    // exists once `fields` is empty, so this still throws (just via the
    // layout check instead of the fields-map check).
    test("fields empty-Map without also clearing sections → Throw", () => {
      expect(() => validateBoot([makeFeature({ fields: {} })])).toThrow(
        /\(secretMint\) layout references unknown field "label"/,
      );
    });

    test("layout referenziert unknown field → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ sections: [{ title: "x", fields: ["ghost"] }] })]),
      ).toThrow(/\(secretMint\) layout references unknown field "ghost"/);
    });

    test("redirect → existing screen-id → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ redirect: "after-mint", extraScreens: ["after-mint"] })]),
      ).not.toThrow();
    });

    test("redirect → unknown screen-id → Throw", () => {
      expect(() => validateBoot([makeFeature({ redirect: "ghost-screen" })])).toThrow(
        /\(secretMint\) redirect "ghost-screen" does not resolve to a registered screen/,
      );
    });

    test("reveal.fields leer → Throw", () => {
      expect(() => validateBoot([makeFeature({ reveal: { fields: [] } })])).toThrow(
        /has an empty reveal\.fields list/,
      );
    });

    test("reveal.fields entry with an empty field → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({ reveal: { fields: [{ field: "", label: "shop:reveal:token" }] } }),
        ]),
      ).toThrow(/has a reveal\.fields entry with an empty or non-string "field"/);
    });

    test("reveal.fields with a duplicate field → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            reveal: {
              fields: [
                { field: "token", label: "a" },
                { field: "token", label: "b" },
              ],
            },
          }),
        ]),
      ).toThrow(/reveal\.fields has a duplicate field "token"/);
    });

    test("reveal.fields entry with an empty label → throws", () => {
      expect(() =>
        validateBoot([makeFeature({ reveal: { fields: [{ field: "token", label: "" }] } })]),
      ).toThrow(/reveal\.fields entry "token" has an empty or non-string "label"/);
    });

    // --- input-less mint: fields: {} + layout.sections: [] is the
    // only valid empty shape — the secret is server-generated, the mint step
    // is just its submit button.
    test("empty fields + empty sections (input-less mint) → no throw", () => {
      expect(() => validateBoot([makeFeature({ fields: {}, sections: [] })])).not.toThrow();
    });

    test("empty fields but non-empty sections list → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ fields: {}, sections: [{ title: "x", fields: ["ghost"] }] })]),
      ).toThrow(/\(secretMint\) layout references unknown field "ghost"/);
    });

    test("non-empty fields but empty sections list → Throw", () => {
      expect(() => validateBoot([makeFeature({ sections: [] })])).toThrow(
        /\(secretMint\) has an empty sections list/,
      );
    });

    // --- confirm step ---
    describe("confirm step", () => {
      test("happy path: confirm handler + fields + layout consistent → no throw", () => {
        expect(() => validateBoot([makeFeature({ confirm: {} })])).not.toThrow();
      });

      test("confirm.handler not a registered write-handler → Throw", () => {
        expect(() =>
          validateBoot([makeFeature({ confirm: { handler: "shop:query:token:list" } })]),
        ).toThrow(
          /\(secretMint confirm\) handler "shop:query:token:list" is not a registered write-handler/,
        );
      });

      test("confirm.fields empty map → Throw", () => {
        expect(() => validateBoot([makeFeature({ confirm: { fields: {} } })])).toThrow(
          /\(secretMint confirm\) has empty fields map/,
        );
      });

      test("confirm layout references unknown field → Throw", () => {
        expect(() =>
          validateBoot([
            makeFeature({ confirm: { sections: [{ title: "x", fields: ["ghost"] }] } }),
          ]),
        ).toThrow(/\(secretMint confirm\) layout references unknown field "ghost"/);
      });

      test("confirm layout mode 'wizard' → Throw", () => {
        expect(() => validateBoot([makeFeature({ confirm: { mode: "wizard" } })])).toThrow(
          /\(secretMint confirm\) sets layout\.mode: "wizard"/,
        );
      });

      test("confirm layout draft true → Throw", () => {
        expect(() => validateBoot([makeFeature({ confirm: { draft: true } })])).toThrow(
          /\(secretMint confirm\) sets layout\.draft: true/,
        );
      });

      test("carry entry colliding with a confirm.fields name → Throw", () => {
        expect(() => validateBoot([makeFeature({ confirm: { carry: ["code"] } })])).toThrow(
          /\(secretMint confirm\) carry field "code" also names a confirm\.fields entry/,
        );
      });

      test("carry entry that is not a confirm.fields name → no throw", () => {
        expect(() =>
          validateBoot([makeFeature({ confirm: { carry: ["setupToken"] } })]),
        ).not.toThrow();
      });
    });
  });

  // --- configEdit screen ---
  // Form for the bundled config feature. The boot validator checks:
  //   1) fields are non-empty and each has a type discriminator
  //   2) the layout is consistent (non-empty sections and existing field references)
  //   3) every field has an entry in `configKeys`
  //   4) every qualified config key in `configKeys` is registered through `r.config(...)`
  describe("configEdit screen", () => {
    type ConfigEditOverride = {
      readonly fields?: Record<string, unknown>;
      readonly sections?: ReadonlyArray<{
        readonly title: string;
        readonly fields: readonly string[];
      }>;
      readonly configKeys?: Readonly<Record<string, string>>;
      readonly mode?: "single" | "wizard";
      readonly draft?: boolean;
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
          layout: {
            sections: sections as never,
            ...(override.mode !== undefined ? { mode: override.mode } : {}),
            ...(override.draft !== undefined ? { draft: override.draft } : {}),
          },
        });
      });
    }

    test("unknown screen type → custom message instead of entity error", () => {
      const feature = defineFeature("shop", (r) => {
        r.screen({ id: "mystery", type: "bogus" } as never);
      });
      expect(() => validateBoot([feature])).toThrow(/Screen "mystery" has unknown type "bogus"\./);
    });

    test("happy path: all 4 checks passed → no throw", () => {
      expect(() => validateBoot([makeFeature()])).not.toThrow();
    });

    test("fields empty-Map → Throw", () => {
      expect(() => validateBoot([makeFeature({ fields: {} })])).toThrow(
        /has empty fields map — declare at least one field/,
      );
    });

    test("field without a type discriminator → throws", () => {
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

    test("field without a configKeys entry → throws with a hint about the mapping", () => {
      // `siteName` is present in the fields map but has no `configKeys` mapping.
      // Boot must fail because no value could be loaded at runtime.
      expect(() =>
        validateBoot([
          makeFeature({
            configKeys: { maxUploadMb: "shop:config:max-upload-mb" },
          }),
        ]),
      ).toThrow(/field "siteName" has no entry in the configKeys map/);
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
      ).toThrow(/Config key "shop:config:typo-here" is not declared in any feature registry/);
    });

    test("camelCase source (multi-word) → canonical kebab-case QN matches, no throw", () => {
      // Regression: `r.config` registers the camelCase object key
      // (`brandingTitle`), while the canonical QN is `shop:config:branding-title`
      // (defineFeature kebab-cases both). A configEdit screen referencing the
      // canonical kebab-case QN must not fail as unknown; without
      // qualifyEntityName the validator compared against the raw camelCase QN.
      const feature = defineFeature("shop", (r) => {
        r.config({ keys: { brandingTitle: createTenantConfig("text", { default: "" }) } });
        r.screen({
          id: "settings",
          type: "configEdit",
          scope: "tenant",
          configKeys: { title: "shop:config:branding-title" },
          fields: { title: { type: "text" } } as never,
          layout: { sections: [{ title: "Basics", fields: ["title"] }] } as never,
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test("extension section without a component → throws (parity with entityEdit)", () => {
      // `synthesizeConfigEditScreen` passes the layout unchanged to RenderEdit;
      // without a react/native marker, an extension section would render empty
      // without an obvious error.
      const section = { kind: "extension", title: "Custom", component: {} };
      expect(() => validateBoot([makeFeature({ sections: [section] as never })])).toThrow(
        /\(configEdit\) extension section "Custom" has no component/,
      );
    });

    test("extension section with a react component → no throw", () => {
      const section = { kind: "extension", title: "Custom", component: { react: "Panel" } };
      expect(() => validateBoot([makeFeature({ sections: [section] as never })])).not.toThrow();
    });
    test("secretKeys nennt ein Feld ausserhalb von fields → Throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.config({ keys: { "site-name": createTenantConfig("text", { default: "" }) } });
        r.screen({
          id: "settings",
          type: "configEdit",
          scope: "tenant",
          configKeys: { siteName: "shop:config:site-name" },
          secretKeys: { smtpPassword: "shop:config:site-name" },
          fields: { siteName: { type: "text" } } as never,
          layout: { sections: [{ title: "Basics", fields: ["siteName"] }] } as never,
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /\(configEdit\) secretKeys names unknown field "smtpPassword"\./,
      );
    });

    test("mode: wizard with only 1 section → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            mode: "wizard",
            sections: [{ title: "Basics", fields: ["siteName"] }],
          }),
        ]),
      ).toThrow(/\(configEdit\).*mode: "wizard" but only 1 section\(s\)/);
    });

    test("draft: true without a mounted form-draft feature → throws", () => {
      const sections = [
        { title: "Step 1", fields: ["siteName"] },
        { title: "Step 2", fields: ["maxUploadMb"] },
      ];
      expect(() => validateBoot([makeFeature({ mode: "wizard", sections, draft: true })])).toThrow(
        /"form-draft" is not mounted/,
      );
    });
  });

  // --- entityEdit extension section ---
  // An extension section delegates rendering to a feature-provided
  // PlatformComponent resolved by name on the client. Without a react/native
  // marker, the slot would render empty at runtime, so boot must fail instead.
  // Field sections are unaffected.
  describe("entityEdit extension section", () => {
    function makeFeature(component: unknown) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
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

    test("extension section without a react/native component → throws", () => {
      expect(() => validateBoot([makeFeature({})])).toThrow(
        /extension section "Custom Fields" has no component — declare a react\/native component marker/,
      );
    });

    test("extension section with a react component → no throw", () => {
      expect(() => validateBoot([makeFeature({ react: "CustomFieldsPanel" })])).not.toThrow();
    });

    test("extension section with a native component → no throw", () => {
      expect(() => validateBoot([makeFeature({ native: "CustomFieldsPanel" })])).not.toThrow();
    });
  });

  // --- entityEdit wizard mode ---
  // layout.mode: "wizard" renders one section per step instead of all
  // sections at once — needs >= 2 sections, each with a title (the step
  // title), or it's a boot-fail instead of a broken step UI.
  describe("entityEdit wizard mode", () => {
    function makeFeature(
      sections: readonly { readonly title?: string; readonly fields: readonly string[] }[],
      mode?: "single" | "wizard",
    ) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: {
              name: createTextField({ personal: false, reason: "test_fixture" }),
              sku: createTextField({ personal: false, reason: "test_fixture" }),
            },
          }),
        });
        r.screen({
          id: "product-edit",
          type: "entityEdit",
          entity: "product",
          layout: {
            sections: sections as never,
            ...(mode !== undefined && { mode }),
          },
        });
      });
    }

    test("mode: wizard with only 1 section → throws", () => {
      expect(() =>
        validateBoot([makeFeature([{ title: "Step 1", fields: ["name"] }], "wizard")]),
      ).toThrow(/mode: "wizard" but only 1 section\(s\)/);
    });

    test("mode: wizard with a section without a title → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature([{ title: "Step 1", fields: ["name"] }, { fields: ["sku"] }], "wizard"),
        ]),
      ).toThrow(/sections\[1\] has no title/);
    });

    test("mode: wizard with >= 2 titled sections → no throw", () => {
      expect(() =>
        validateBoot([
          makeFeature(
            [
              { title: "Step 1", fields: ["name"] },
              { title: "Step 2", fields: ["sku"] },
            ],
            "wizard",
          ),
        ]),
      ).not.toThrow();
    });

    test("mode omitted (default 'single') keeps the existing layout valid → no throw", () => {
      expect(() =>
        validateBoot([makeFeature([{ title: "Details", fields: ["name", "sku"] }])]),
      ).not.toThrow();
    });
  });

  // --- entityEdit redirect ---
  // Post-save navigation target, same validation as actionForm's redirect:
  // short screen-ID, same feature, must resolve to a registered screen.
  describe("entityEdit redirect", () => {
    function makeFeature(
      redirect?: string | { readonly screen: string; readonly idFrom: string },
      extraScreens: readonly string[] = [],
    ) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: {
              name: createTextField({ personal: false, reason: "test_fixture" }),
              sku: createTextField({ personal: false, reason: "test_fixture" }),
            },
          }),
        });
        r.screen({
          id: "product-edit",
          type: "entityEdit",
          entity: "product",
          layout: { sections: [{ fields: ["name", "sku"] }] },
          ...(redirect !== undefined && { redirect }),
        });
        for (const extra of extraScreens) {
          r.screen({
            id: extra,
            type: "custom",
            renderer: { react: "stub" },
          });
        }
      });
    }

    test("redirect → existing screen-id in the same feature → no throw", () => {
      expect(() => validateBoot([makeFeature("product-list", ["product-list"])])).not.toThrow();
    });

    test("redirect → unknown screen-id → Throw", () => {
      expect(() => validateBoot([makeFeature("ghost-screen")])).toThrow(
        /redirect "ghost-screen" does not resolve to a registered screen/,
      );
    });

    test("no redirect set → no throw (default: list)", () => {
      expect(() => validateBoot([makeFeature()])).not.toThrow();
    });

    // --- redirect: cross-feature QN ---
    test("redirect → fully qualified cross-feature QN → no throw", () => {
      const consumer = defineFeature("statements", (r) => {
        r.screen({ id: "statement-upload-list", type: "custom", renderer: { react: "stub" } });
      });
      expect(() =>
        validateBoot([makeFeature("statements:screen:statement-upload-list"), consumer]),
      ).not.toThrow();
    });

    test("redirect → unbekannte Cross-Feature-QN → Throw", () => {
      expect(() => validateBoot([makeFeature("statements:screen:ghost-screen")])).toThrow(
        /redirect "statements:screen:ghost-screen" does not resolve to a registered screen/,
      );
    });

    // --- redirect object form with idFrom (same rule as actionForm's) ---
    test("redirect object → existing id-carrying screen → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ screen: "product-edit", idFrom: "parentId" })]),
      ).not.toThrow();
    });

    test("redirect object with idFrom → screen without an ID (custom) → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({ screen: "product-list", idFrom: "parentId" }, ["product-list"]),
        ]),
      ).toThrow(
        /redirect\.idFrom is set but target screen "product-list" \(custom\) carries no id/,
      );
    });

    test("redirect object → unknown screen-id → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ screen: "ghost-screen", idFrom: "parentId" })]),
      ).toThrow(/redirect "ghost-screen" does not resolve to a registered screen/);
    });

    test("redirect object with an empty idFrom → throws", () => {
      expect(() =>
        validateBoot([makeFeature({ screen: "product-list", idFrom: "  " }, ["product-list"])]),
      ).toThrow(/redirect\.idFrom is empty/);
    });
  });

  // --- no-widget field types + required ---
  // jsonb/embedded render read-only on the auto-wired
  // entityEdit path (render-field.tsx) — a statically-`required: true`
  // field of one of these types would be unresolvable by the user, so it's
  // caught loudly at boot instead of silently accepting an unfillable form.
  // Only the static case (literal `true`, entity-level or screen-spec) is
  // checked; a dynamic FieldCondition can't be evaluated without runtime
  // form values and is a documented, accepted gap.
  describe("no-widget field types + required", () => {
    test("embedded field, entity-level required: true → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                lines: createEmbeddedField({ note: { type: "text" } }, { required: true }),
              },
            }),
          });
          r.screen({
            id: "order-edit",
            type: "entityEdit",
            entity: "order",
            layout: { sections: [{ fields: ["lines"] }] },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /field "lines" is type "embedded", which renders read-only/,
      );
    });

    test("embedded field, entity-level required: true, screen-spec required: false override → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                lines: createEmbeddedField({ note: { type: "text" } }, { required: true }),
              },
            }),
          });
          r.screen({
            id: "order-edit",
            type: "entityEdit",
            entity: "order",
            layout: { sections: [{ fields: [{ field: "lines", required: false }] }] },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("embedded field, entity-level required: true, screen-spec readOnly: true → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                lines: createEmbeddedField({ note: { type: "text" } }, { required: true }),
              },
            }),
          });
          r.screen({
            id: "order-edit",
            type: "entityEdit",
            entity: "order",
            layout: { sections: [{ fields: [{ field: "lines", readOnly: true }] }] },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("embedded field, entity-level required: true, dynamic screen-spec required condition → no throw (not statically resolvable)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                kind: createTextField({ personal: false, reason: "test_fixture" }),
                lines: createEmbeddedField({ note: { type: "text" } }, { required: true }),
              },
            }),
          });
          r.screen({
            id: "order-edit",
            type: "entityEdit",
            entity: "order",
            layout: {
              sections: [
                { fields: ["kind", { field: "lines", required: { field: "kind", eq: "b2b" } }] },
              ],
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("jsonb field, screen-spec required: true override → Throw (JsonbFieldDef has no entity-level required)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({ name: "order", ...createEntity({ fields: { data: createJsonbField() } }) });
          r.screen({
            id: "order-edit",
            type: "entityEdit",
            entity: "order",
            layout: { sections: [{ fields: [{ field: "data", required: true }] }] },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /field "data" is type "jsonb", which renders read-only/,
      );
    });

    test("files and images field, screen-spec required: true → no throw (FileListField widget)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: { attachments: createFilesField(), gallery: createImagesField() },
            }),
          });
          r.screen({
            id: "order-edit",
            type: "entityEdit",
            entity: "order",
            layout: {
              sections: [
                {
                  fields: [
                    { field: "attachments", required: true },
                    { field: "gallery", required: true },
                  ],
                },
              ],
            },
          });
        }),
      ];
      process.env["FILE_STORAGE_PROVIDER"] = "local";
      try {
        expect(() => validateBoot(features)).not.toThrow();
      } finally {
        delete process.env["FILE_STORAGE_PROVIDER"];
      }
    });

    test("multiSelect field, entity-level required: true → no throw (has a combobox widget)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "product",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({ options: ["a", "b"] as const, required: true }),
              },
            }),
          });
          r.screen({
            id: "product-edit",
            type: "entityEdit",
            entity: "product",
            layout: { sections: [{ fields: ["tags"] }] },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("embedded LIST field (multiple: true), entity-level required: true → no throw (has an EmbeddedListField grid widget)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "invoice",
            ...createEntity({
              fields: {
                lines: createEmbeddedListField({ note: { type: "text" } }, { required: true }),
              },
            }),
          });
          r.screen({
            id: "invoice-edit",
            type: "entityEdit",
            entity: "invoice",
            layout: { sections: [{ fields: ["lines"] }] },
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });
  });

  // --- ReferenceFieldDef ---
  describe("reference field (Tier 2.7e-3)", () => {
    test("reference to an existing Entity → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "customer",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "customer");
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: { type: "reference", entity: "customer", labelField: "name" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference auf unknown Entity → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: { type: "reference", entity: "ghost-entity" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "customerId" on entity "order" targets unknown entity "ghost-entity"/,
      );
    });

    test("reference labelField auf unknown Field → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "customer",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: { type: "reference", entity: "customer", labelField: "ghost-field" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /references labelField "ghost-field" which does not exist on entity "customer"/,
      );
    });

    test("reference labelField=id is always valid (PK)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "customer",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "customer");
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: { type: "reference", entity: "customer", labelField: "id" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("self-reference (entity → entity) → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "category",
            ...createEntity({
              fields: {
                name: createTextField({ personal: false, reason: "test_fixture" }),
                parentId: { type: "reference", entity: "category", labelField: "name" },
              },
            }),
          });
          stubListHandler(r, "category");
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference with multiple: true → no throw (Tier 2.7e-Multi)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "tag",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "tag");
          r.entity({
            name: "post",
            ...createEntity({
              fields: {
                title: createTextField({ personal: false, reason: "test_fixture" }),
                tagIds: {
                  type: "reference",
                  entity: "tag",
                  labelField: "name",
                  multiple: true,
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    // --- Cross-Feature: "feature:entity" Form ---
    test("cross-feature reference (feature:entity) → no throw", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity({
            name: "user",
            ...createEntity({
              fields: { email: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "user");
        }),
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: { type: "reference", entity: "users:user", labelField: "email" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("cross-feature reference without a list-handler → throws", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity({
            name: "user",
            ...createEntity({
              fields: { email: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          // No stub list handler is registered intentionally; its absence is the condition under
          // test.
        }),
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: { type: "reference", entity: "users:user" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /no list-query-handler is registered there\. Add r\.queryHandler\(defineEntityListHandler\("user"/,
      );
    });

    test("cross-feature reference to an unknown feature → throws with a clear message", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: { type: "reference", entity: "ghost-feature:user" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /targets unknown feature "ghost-feature" via "ghost-feature:user"/,
      );
    });

    test("cross-feature reference to an unknown entity → throws with feature context", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity({
            name: "user",
            ...createEntity({
              fields: { email: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
        }),
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: { type: "reference", entity: "users:ghost-entity" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /targets unknown entity "ghost-entity" in feature "users"/,
      );
    });

    test("cross-feature labelField auf unknown Field → Throw", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity({
            name: "user",
            ...createEntity({
              fields: { email: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
        }),
        defineFeature("shop", (r) => {
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: {
                  type: "reference",
                  entity: "users:user",
                  labelField: "ghost-field",
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /references labelField "ghost-field" which does not exist on entity "user"/,
      );
    });
  });

  // --- Reference sub-fields of an embedded-list field get the
  // same target/labelField/query-handler checks as a top-level reference
  // field, so a bad "lines.productId" fails at boot instead of crashing
  // the Combobox at runtime.
  describe("embedded-list reference sub-field", () => {
    test("reference sub-field targeting an unknown entity → Throw with the parent.child field path", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "invoice",
            ...createEntity({
              fields: {
                lines: createEmbeddedListField({
                  productId: { type: "reference", entity: "ghost-entity" },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "lines\.productId" on entity "invoice" targets unknown entity "ghost-entity"/,
      );
    });

    test("reference sub-field with a valid target + registered list-handler → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "product",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "product");
          r.entity({
            name: "invoice",
            ...createEntity({
              fields: {
                lines: createEmbeddedListField({
                  productId: { type: "reference", entity: "product", labelField: "name" },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference sub-field with a valid target but no registered list-handler → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "product",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          // No stub list handler is registered intentionally; its absence is the condition under
          // test.
          r.entity({
            name: "invoice",
            ...createEntity({
              fields: {
                lines: createEmbeddedListField({
                  productId: { type: "reference", entity: "product" },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "lines\.productId" on entity "invoice" targets entity "product" but no list-query-handler is registered/,
      );
    });

    test("reference optionsQuery naming a registered handler → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "customer",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "customer");
          r.queryHandler({
            name: "customer:options",
            schema: z.object({}),
            handler: async () => ({ rows: [] }) as never,
            access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
          });
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: {
                  type: "reference",
                  entity: "customer",
                  optionsQuery: "shop:query:customer:options",
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference optionsQuery on an unregistered handler → throws", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "customer",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "customer");
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: {
                  type: "reference",
                  entity: "customer",
                  optionsQuery: "shop:query:customer:typo",
                },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "customerId" on entity "order" declares optionsQuery "shop:query:customer:typo" which is not a registered query-handler/,
      );
    });

    test("empty optionsQuery → throws", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "customer",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "customer");
          r.entity({
            name: "order",
            ...createEntity({
              fields: {
                customerId: { type: "reference", entity: "customer", optionsQuery: "" },
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/has an empty optionsQuery/);
    });

    test("reference sub-field optionsQuery on an unregistered handler → throws with parent.child path", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "product",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "product");
          r.entity({
            name: "invoice",
            ...createEntity({
              fields: {
                lines: createEmbeddedListField({
                  productId: {
                    type: "reference",
                    entity: "product",
                    optionsQuery: "shop:query:product:typo",
                  },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "lines\.productId" on entity "invoice" declares optionsQuery "shop:query:product:typo"/,
      );
    });

    test("reference sub-field labelField referencing an unknown field → Throw with the parent.child field path", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity({
            name: "product",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          stubListHandler(r, "product");
          r.entity({
            name: "invoice",
            ...createEntity({
              fields: {
                lines: createEmbeddedListField({
                  productId: {
                    type: "reference",
                    entity: "product",
                    labelField: "ghost-field",
                  },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "lines\.productId" on entity "invoice" references labelField "ghost-field" which does not exist on entity "product"/,
      );
    });
  });

  // --- rowAction kind="navigate" target existence ---
  describe("entityList rowAction kind=navigate (Tier 2.7e-1)", () => {
    function makeFeature(targetScreen: string, withTarget: boolean) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
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

    test("navigate-target → registered screen → no throw", () => {
      expect(() => validateBoot([makeFeature("product-edit", true)])).not.toThrow();
    });

    test("navigate-target → unknown screen → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature("ghost-screen", false)])).toThrow(
        /rowAction "edit" navigate-target "ghost-screen" does not resolve/,
      );
    });

    test("navigate-target → screen in ANOTHER feature → no throw (cross-feature)", () => {
      // A declarative list in the entity's owning feature can navigate to a
      // consumer application's custom editor in another feature. Runtime
      // resolves the bare ID application-wide, so the validator must allow it.
      const list = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [
            { kind: "navigate", id: "edit", label: "actions.edit", screen: "product-editor" },
          ],
        });
      });
      const consumer = defineFeature("app", (r) => {
        r.screen({ id: "product-editor", type: "custom", renderer: { react: "stub" } });
      });
      expect(() => validateBoot([list, consumer])).not.toThrow();
    });

    test("cross-feature navigate to an entityEdit screen WITHOUT entityId → Throw", () => {
      // Regression: the renderer's same-feature row["id"] fallback never
      // fires for a cross-feature target, so the edit screen would silently
      // open with no entity context at runtime. The validator must catch it
      // at boot instead.
      const list = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [
            { kind: "navigate", id: "edit", label: "actions.edit", screen: "invoice-edit" },
          ],
        });
      });
      const consumer = defineFeature("billing", (r) => {
        r.entity({
          name: "invoice",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "invoice-edit",
          type: "entityEdit",
          entity: "invoice",
          layout: { sections: [{ columns: 1, fields: ["name"] }] },
        });
      });
      expect(() => validateBoot([list, consumer])).toThrow(
        /rowAction "edit".*cross-feature to entityEdit screen "invoice-edit".*without an explicit entityId/,
      );
    });

    test("cross-feature navigate to an entityEdit screen WITH entityId → no throw", () => {
      const list = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: {
              name: createTextField({ personal: false, reason: "test_fixture" }),
              invoiceId: createTextField({ personal: false, reason: "test_fixture" }),
            },
          }),
        });
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
              screen: "invoice-edit",
              entityId: "invoiceId",
            },
          ],
        });
      });
      const consumer = defineFeature("billing", (r) => {
        r.entity({
          name: "invoice",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "invoice-edit",
          type: "entityEdit",
          entity: "invoice",
          layout: { sections: [{ columns: 1, fields: ["name"] }] },
        });
      });
      expect(() => validateBoot([list, consumer])).not.toThrow();
    });

    test("same-feature navigate to entityEdit WITHOUT entityId → no throw (same-feature fallback applies)", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [
            { kind: "navigate", id: "edit", label: "actions.edit", screen: "product-edit" },
          ],
        });
        r.screen({
          id: "product-edit",
          type: "entityEdit",
          entity: "product",
          layout: { sections: [{ columns: 1, fields: ["name"] }] },
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });
  });

  // --- rowAction navigate-target as an entity instead of a screen ---
  describe("entityList rowAction kind=navigate entity-target", () => {
    test("entity-target resolving via detailFor → no throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [{ kind: "navigate", id: "view", label: "actions.view", entity: "product" }],
        });
        r.screen({
          id: "product-detail",
          type: "custom",
          renderer: { react: "stub" },
          detailFor: "product",
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test("entity-target with no detailFor screen anywhere → throws with a clear message", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [{ kind: "navigate", id: "view", label: "actions.view", entity: "product" }],
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /rowAction "view" navigate-target entity "product" has no screen declaring detailFor: "product"/,
      );
    });

    test("both screen and entity set → Throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [
            {
              kind: "navigate",
              id: "view",
              label: "actions.view",
              screen: "product-detail",
              entity: "product",
            } as never,
          ],
        });
        r.screen({
          id: "product-detail",
          type: "custom",
          renderer: { react: "stub" },
          detailFor: "product",
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /rowAction "view" sets both "screen" and "entity"/,
      );
    });

    test("neither screen nor entity set → Throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [{ kind: "navigate", id: "view", label: "actions.view" } as never],
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /rowAction "view" sets neither "screen" nor "entity"/,
      );
    });

    test("entity-target resolving cross-feature to a NON-entityEdit detailFor screen → no throw", () => {
      // Mirrors the existing cross-feature screen-target case above, but via
      // detailFor resolution — the owning feature's list navigates to a
      // detail screen a consumer app registers for the entity.
      const list = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [{ kind: "navigate", id: "view", label: "actions.view", entity: "product" }],
        });
      });
      const consumer = defineFeature("app", (r) => {
        r.screen({
          id: "product-detail",
          type: "custom",
          renderer: { react: "stub" },
          detailFor: "product",
        });
      });
      expect(() => validateBoot([list, consumer])).not.toThrow();
    });

    test("entity-target resolving cross-feature to an entityEdit detailFor screen WITHOUT entityId → no throw", () => {
      // Regression guard: the cross-feature-entityEdit-needs-explicit-entityId
      // check (screen-target branch) must NOT fire for entity-targets — the
      // renderer always supplies an id for those (explicit entityId, else
      // row["id"]), so the same-feature-fallback gap that check guards
      // against doesn't exist here.
      const list = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [{ kind: "navigate", id: "edit", label: "actions.edit", entity: "invoice" }],
        });
      });
      const consumer = defineFeature("billing", (r) => {
        r.entity({
          name: "invoice",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "invoice-edit",
          type: "entityEdit",
          entity: "invoice",
          layout: { sections: [{ columns: 1, fields: ["name"] }] },
          detailFor: "invoice",
        });
      });
      expect(() => validateBoot([list, consumer])).not.toThrow();
    });

    test("projectionList rowAction entity-target without explicit entityId → Throw", () => {
      // projectionList rows come from an arbitrary query projection with no
      // guaranteed "id" field, unlike entityList rows — an entity-target
      // there must name the field to read the id from.
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.queryHandler({
          name: "products",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "product-projection",
          type: "projectionList",
          query: "shop:query:products",
          columns: ["name"],
          rowActions: [{ kind: "navigate", id: "view", label: "actions.view", entity: "product" }],
        });
        r.screen({
          id: "product-detail",
          type: "custom",
          renderer: { react: "stub" },
          detailFor: "product",
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /rowAction "view" navigate-target entity "product" needs an explicit "entityId"/,
      );
    });

    test("projectionList rowAction entity-target with explicit entityId → no throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.queryHandler({
          name: "products",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "product-projection",
          type: "projectionList",
          query: "shop:query:products",
          columns: ["name"],
          rowActions: [
            {
              kind: "navigate",
              id: "view",
              label: "actions.view",
              entity: "product",
              entityId: "productId",
            },
          ],
        });
        r.screen({
          id: "product-detail",
          type: "custom",
          renderer: { react: "stub" },
          detailFor: "product",
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test("projectionDetail action entity-target without explicit entityId → Throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order-detail",
          layout: { sections: [{ fields: ["total"] }] },
          actions: [
            { kind: "navigate", id: "view-product", label: "actions.view", entity: "product" },
          ],
        });
        r.screen({
          id: "product-detail",
          type: "custom",
          renderer: { react: "stub" },
          detailFor: "product",
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /action "view-product" navigate-target entity "product" needs an explicit "entityId"/,
      );
    });
  });

  describe("clientAction row actions", () => {
    function orderQuery(r: Parameters<Parameters<typeof defineFeature>[1]>[0]): void {
      r.queryHandler({
        name: "orders",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
    }

    function listWithClientAction(action: string) {
      return defineFeature("shop", (r) => {
        orderQuery(r);
        r.screen({
          id: "order-list",
          type: "projectionList",
          query: "shop:query:orders",
          columns: [{ field: "name", label: "shop:col:name" }],
          rowActions: [{ kind: "clientAction", id: "send", label: "shop:action:send", action }],
        });
      });
    }

    test("accepts <feature>:<kebab>", () => {
      expect(() =>
        validateBoot([listWithClientAction("auth-email-password:request-password-reset")]),
      ).not.toThrow();
    });

    test.each(["resetPassword", "shop:", "shop:Reset", "a:b:c", "reset"])(
      "rejects the malformed name %s",
      (name) => {
        expect(() => validateBoot([listWithClientAction(name)])).toThrow(
          /is not a client action name — expected "<feature>:<kebab-name>"/,
        );
      },
    );

    test("projectionDetail header action is checked too", () => {
      const feature = defineFeature("shop", (r) => {
        r.queryHandler({
          name: "order-detail",
          schema: z.object({}),
          handler: async () => ({ id: "o1" }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order-detail",
          layout: { sections: [{ fields: ["total"] }] },
          actions: [
            { kind: "clientAction", id: "send", label: "shop:action:send", action: "Not Valid" },
          ],
        });
      });
      expect(() => validateBoot([feature])).toThrow(/action "send" action "Not Valid"/);
    });
  });

  // --- action/rowAction drawer-target reachability across the remaining
  //     RowAction call sites: projectionDetail.actions,
  //     entityEdit.actions, and a relatedList section's rowActions. The
  //     entityList/projectionList rowAction and toolbarAction drawer cases
  //     are covered above — this pins the drawer branch actually being
  //     reached (not skipped/mis-nested) at the other three sites, and the
  //     "action" actionLabel used by both non-list call sites. ---
  describe("drawer-target reachability at the remaining RowAction call sites", () => {
    test('projectionDetail.actions drawer-target unknown → throw with actionLabel "action"', () => {
      const feature = defineFeature("shop", (r) => {
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order-detail",
          layout: { sections: [{ fields: ["total"] }] },
          actions: [
            { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "ghost-form" },
          ],
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /action "add-note" drawer-target "ghost-form" does not resolve to a registered screen/,
      );
    });

    test('entityEdit.actions drawer-target unknown → throw with actionLabel "action"', () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-edit",
          type: "entityEdit",
          entity: "product",
          layout: { sections: [{ title: "Basics", fields: ["name"] }] },
          actions: [
            { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "ghost-form" },
          ],
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /action "add-note" drawer-target "ghost-form" does not resolve to a registered screen/,
      );
    });

    test("entityEdit header action with a malformed clientAction name → throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-edit",
          type: "entityEdit",
          entity: "product",
          layout: { sections: [{ title: "Basics", fields: ["name"] }] },
          actions: [
            { kind: "clientAction", id: "send", label: "actions.send", action: "Not Valid" },
          ],
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /\(entityEdit\) action "send" action "Not Valid" is not a client action name/,
      );
    });

    test("entityEdit.actions drawer-target → registered actionForm → no throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.writeHandler({
          name: "add-note",
          schema: z.object({ note: z.string() }),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
        r.screen({
          id: "product-edit",
          type: "entityEdit",
          entity: "product",
          layout: { sections: [{ title: "Basics", fields: ["name"] }] },
          actions: [
            { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "note-form" },
          ],
        });
        r.screen({
          id: "note-form",
          type: "actionForm",
          handler: "shop:write:add-note",
          fields: { note: { type: "text" } } as never,
          layout: { sections: [{ fields: ["note"] }] },
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test('projectionDetail relatedList section rowAction drawer-target unknown → throw with actionLabel "rowAction"', () => {
      const feature = defineFeature("shop", (r) => {
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order-detail",
          layout: {
            sections: [
              {
                kind: "relatedList",
                title: "Positions",
                query: "shop:query:order-positions",
                columns: [{ field: "name" }],
                rowActions: [
                  {
                    kind: "drawer",
                    id: "add-note",
                    label: "actions.addNote",
                    screen: "ghost-form",
                  },
                ],
              },
            ],
          },
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /rowAction "add-note" drawer-target "ghost-form" does not resolve to a registered screen/,
      );
    });

    test("projectionDetail tabs-mode fields section with both groups and actions → throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order-detail",
          layout: {
            mode: "tabs",
            sections: [
              {
                id: "billing",
                title: "Billing",
                groups: [{ title: "Amounts", fields: ["name"] }],
                actions: [
                  { kind: "navigate", id: "edit", label: "actions.edit", screen: "order-detail" },
                ],
              },
              {
                id: "positions",
                kind: "relatedList",
                title: "Positions",
                query: "shop:query:order-positions",
                columns: [{ field: "name" }],
              },
            ],
          },
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /section "billing" declares both groups and actions in tabs mode/,
      );
    });

    test("projectionDetail relatedList defaultSort.field not a listed column → throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order-detail",
          layout: {
            sections: [
              {
                kind: "relatedList",
                title: "Positions",
                query: "shop:query:order-positions",
                columns: [{ field: "name", sortable: true }],
                defaultSort: { field: "price", dir: "asc" },
              },
            ],
          },
        });
      });
      expect(() => validateBoot([feature])).toThrow(
        /defaultSort\.field "price" is not a listed column/,
      );
    });

    test("projectionDetail relatedList defaultSort.field not sortable → throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order-detail",
          layout: {
            sections: [
              {
                kind: "relatedList",
                title: "Positions",
                query: "shop:query:order-positions",
                columns: [{ field: "name" }],
                defaultSort: { field: "name", dir: "asc" },
              },
            ],
          },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/defaultSort\.field "name" is not sortable/);
    });

    test("projectionDetail relatedList defaultSort.field sortable → no throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.queryHandler({
          name: "order-detail",
          schema: z.object({}),
          handler: async () => ({ id: "o1" }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.queryHandler({
          name: "order-positions",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order-detail",
          layout: {
            sections: [
              {
                kind: "relatedList",
                title: "Positions",
                query: "shop:query:order-positions",
                columns: [{ field: "name", sortable: true }],
                defaultSort: { field: "name", dir: "asc" },
              },
            ],
          },
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });
  });

  // --- Screen short-id collision across features ---
  describe("screen short-id collisions across features", () => {
    test("two features registering the same short screen-id → Throw", () => {
      const a = defineFeature("shop", (r) => {
        r.screen({ id: "settings", type: "custom", renderer: { react: "stub" } });
      });
      const b = defineFeature("billing", (r) => {
        r.screen({ id: "settings", type: "custom", renderer: { react: "stub" } });
      });
      expect(() => validateBoot([a, b])).toThrow(
        /Screen short-id "settings" is registered by 2 features \(shop, billing\)/,
      );
    });

    test("distinct short-ids across features → no throw", () => {
      const a = defineFeature("shop", (r) => {
        r.screen({ id: "shop-settings", type: "custom", renderer: { react: "stub" } });
      });
      const b = defineFeature("billing", (r) => {
        r.screen({ id: "billing-settings", type: "custom", renderer: { react: "stub" } });
      });
      expect(() => validateBoot([a, b])).not.toThrow();
    });
  });

  // --- rowAction rowClick (row-body click) ---
  describe("entityList rowAction rowClick", () => {
    function makeFeature(rowClickCount: number) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({ id: "product-editor", type: "custom", renderer: { react: "stub" } });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: Array.from({ length: rowClickCount }, (_, i) => ({
            kind: "navigate" as const,
            id: `open-${i}`,
            label: "actions.edit",
            screen: "product-editor",
            rowClick: true,
          })),
        });
      });
    }

    test("one rowClick navigate action passes boot", () => {
      expect(() => validateBoot([makeFeature(1)])).not.toThrow();
    });

    test("more than one rowClick action per list is rejected", () => {
      expect(() => validateBoot([makeFeature(2)])).toThrow(
        /at most one may fire on a row-body click/i,
      );
    });
  });

  // --- rowAction kind="writeHandler" handler-QN validation (extended) ---
  describe("entityList rowAction kind=writeHandler handler-QN", () => {
    function makeFeature(handlerQn: string, register: boolean) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [{ id: "delete", label: "actions.delete", handler: handlerQn }],
        });
        if (register) {
          r.writeHandler({
            name: "delete",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
        }
      });
    }

    test("handler → registered → no throw", () => {
      expect(() => validateBoot([makeFeature("shop:write:delete", true)])).not.toThrow();
    });

    test("handler → not registered → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature("shop:write:ghost", false)])).toThrow(
        /rowAction "delete" .*handler "shop:write:ghost" is not a registered write-handler/,
      );
    });
  });

  // --- rowAction payload extractor field references ---
  // Row metadata (id, version) is present on every entity row without being an
  // entity field — pick ["id", "version"] is the standard payload
  // for optimistic-lock lifecycle writes and must not break boot
  // (production incident: the 0.40 validator rejected
  // maintenance-start/cancel/complete, causing CrashLoopBackOff).
  describe("entityList rowAction payload pick (Tier 2.7e-3)", () => {
    function makeFeature(pick: readonly string[]) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
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
        r.writeHandler({
          name: "archive",
          schema: z.object({}),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
      });
    }

    test("pick with row metadata id + version → no throw (optimistic-lock standard)", () => {
      expect(() => validateBoot([makeFeature(["id", "version"])])).not.toThrow();
    });

    test("pick with an entity field → no throw", () => {
      expect(() => validateBoot([makeFeature(["id", "name"])])).not.toThrow();
    });

    test("pick with an unknown field → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature(["id", "ghost"])])).toThrow(
        /rowAction "archive" payload references unknown field "ghost"/,
      );
    });
  });

  // --- row-meta allowlist: all base columns, not just id/version ---
  // `buildBaseColumns` adds `tenantId`/`insertedAt`/`modifiedAt` and other base
  // columns to every row, so using them in pick/map/visible is valid. Soft-delete
  // columns (`isDeleted`/...) exist only on soft-delete entities and must still
  // fail validation when absent.
  describe("entityList rowAction row-meta allowlist", () => {
    function makeFeature(opts: {
      pick?: readonly string[];
      map?: Record<string, string>;
      visibleField?: string;
      softDelete?: boolean;
    }) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            softDelete: opts.softDelete ?? false,
          }),
        });
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
              ...(opts.pick ? { payload: { pick: [...opts.pick] } } : {}),
              ...(opts.map ? { payload: { map: { ...opts.map } } } : {}),
              ...(opts.visibleField ? { visible: { field: opts.visibleField, eq: true } } : {}),
            },
          ],
        });
        r.writeHandler({
          name: "archive",
          schema: z.object({}),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
      });
    }

    test("pick with base column tenantId → no throw", () => {
      expect(() => validateBoot([makeFeature({ pick: ["id", "tenantId"] })])).not.toThrow();
    });

    test("visible.field on row metadata (version) → no throw", () => {
      expect(() => validateBoot([makeFeature({ visibleField: "version" })])).not.toThrow();
    });

    test("visible.field on id → no throw (aggregate id is always present)", () => {
      expect(() => validateBoot([makeFeature({ visibleField: "id" })])).not.toThrow();
    });

    test("visible.field auf unknown Field → Throw", () => {
      expect(() => validateBoot([makeFeature({ visibleField: "ghost" })])).toThrow(
        /visible\.field references unknown field "ghost"/,
      );
    });

    test("map extractor with base column tenantId → no throw", () => {
      expect(() => validateBoot([makeFeature({ map: { target: "tenantId" } })])).not.toThrow();
    });

    test("map extractor with an unknown field → throws", () => {
      expect(() => validateBoot([makeFeature({ map: { target: "ghost" } })])).toThrow(
        /payload references unknown field "ghost"/,
      );
    });

    test("softDelete entity: pick isDeleted → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ pick: ["id", "isDeleted"], softDelete: true })]),
      ).not.toThrow();
    });

    test("non-softDelete entity: pick isDeleted → throws (column does not exist)", () => {
      expect(() =>
        validateBoot([makeFeature({ pick: ["id", "isDeleted"], softDelete: false })]),
      ).toThrow(/references unknown field "isDeleted"/);
    });
  });

  // --- toolbarAction navigate + writeHandler validation ---
  describe("entityList toolbarAction navigate (Tier 2.7e-2)", () => {
    function makeFeature(targetScreen: string, withTarget: boolean) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
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

    test("navigate-target → registered → no throw", () => {
      expect(() => validateBoot([makeFeature("product-form", true)])).not.toThrow();
    });

    test("navigate-target → unknown → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature("ghost-form", false)])).toThrow(
        /toolbarAction "open-form" navigate-target "ghost-form" does not resolve/,
      );
    });

    test("navigate-target → screen in ANOTHER feature → no throw (cross-feature)", () => {
      const list = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          toolbarActions: [
            { kind: "navigate", id: "new", label: "actions.new", screen: "product-editor" },
          ],
        });
      });
      const consumer = defineFeature("app", (r) => {
        r.screen({ id: "product-editor", type: "custom", renderer: { react: "stub" } });
      });
      expect(() => validateBoot([list, consumer])).not.toThrow();
    });
  });

  describe("entityList toolbarAction writeHandler handler-QN (Tier 2.7e-2)", () => {
    function makeFeature(handlerQn: string, register: boolean) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
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
          r.writeHandler({
            name: "sync",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
        }
      });
    }

    test("handler → registered → no throw", () => {
      expect(() => validateBoot([makeFeature("shop:write:sync", true)])).not.toThrow();
    });

    test("handler → not registered → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature("shop:write:ghost", false)])).toThrow(
        /toolbarAction "sync" .*handler "shop:write:ghost" is not a registered write-handler/,
      );
    });
  });

  // --- toolbarAction drawer ---
  describe("entityList toolbarAction drawer", () => {
    function makeFeature(opts: {
      readonly targetId?: string;
      readonly targetType?: "actionForm" | "entityList";
    }) {
      const targetId = opts.targetId ?? "restock-form";
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          toolbarActions: [
            { kind: "drawer", id: "open-drawer", label: "actions.restock", screen: targetId },
          ],
        });
        if (opts.targetType === "entityList") {
          r.screen({
            id: targetId,
            type: "entityList",
            entity: "product",
            columns: ["name"],
          });
          return;
        }
        if (opts.targetType === "actionForm") {
          r.writeHandler({
            name: "restock",
            schema: z.object({ qty: z.number() }),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
          r.screen({
            id: targetId,
            type: "actionForm",
            handler: "shop:write:restock",
            fields: { qty: { type: "number" } } as never,
            layout: { sections: [{ fields: ["qty"] }] },
          });
        }
      });
    }

    test("drawer-target → registered actionForm → no throw", () => {
      expect(() => validateBoot([makeFeature({ targetType: "actionForm" })])).not.toThrow();
    });

    test("drawer-target → unknown → throw with a clear message", () => {
      expect(() => validateBoot([makeFeature({ targetId: "ghost-form" })])).toThrow(
        /toolbarAction "open-drawer" drawer-target "ghost-form" does not resolve to a registered screen/,
      );
    });

    test("drawer-target → screen exists but is not an actionForm → throw with a clear message", () => {
      expect(() =>
        validateBoot([makeFeature({ targetId: "product-list-2", targetType: "entityList" })]),
      ).toThrow(
        /toolbarAction "open-drawer" drawer-target "product-list-2" is a "entityList" screen, not an actionForm/,
      );
    });

    test("drawer-target → actionForm in ANOTHER feature → throw (drawer resolves same-feature only)", () => {
      const list = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          toolbarActions: [
            { kind: "drawer", id: "open-drawer", label: "actions.restock", screen: "restock-form" },
          ],
        });
      });
      const consumer = defineFeature("app", (r) => {
        r.writeHandler({
          name: "restock",
          schema: z.object({ qty: z.number() }),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
        r.screen({
          id: "restock-form",
          type: "actionForm",
          handler: "app:write:restock",
          fields: { qty: { type: "number" } } as never,
          layout: { sections: [{ fields: ["qty"] }] },
        });
      });
      expect(() => validateBoot([list, consumer])).toThrow(
        /toolbarAction "open-drawer" drawer-target "restock-form" does not resolve to a registered screen in this feature/,
      );
    });
  });

  // --- entityList rowAction drawer ---
  describe("entityList rowAction drawer", () => {
    function makeFeature(opts: {
      readonly targetId?: string;
      readonly targetType?: "actionForm" | "entityList";
    }) {
      const targetId = opts.targetId ?? "restock-form";
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [
            { kind: "drawer", id: "open-drawer", label: "actions.restock", screen: targetId },
          ],
        });
        if (opts.targetType === "entityList") {
          r.screen({
            id: targetId,
            type: "entityList",
            entity: "product",
            columns: ["name"],
          });
          return;
        }
        if (opts.targetType === "actionForm") {
          r.writeHandler({
            name: "restock",
            schema: z.object({ qty: z.number() }),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
          r.screen({
            id: targetId,
            type: "actionForm",
            handler: "shop:write:restock",
            fields: { qty: { type: "number" } } as never,
            layout: { sections: [{ fields: ["qty"] }] },
          });
        }
      });
    }

    test("drawer-target → registered actionForm → no throw", () => {
      expect(() => validateBoot([makeFeature({ targetType: "actionForm" })])).not.toThrow();
    });

    test("drawer-target → unknown → throw with a clear message", () => {
      expect(() => validateBoot([makeFeature({ targetId: "ghost-form" })])).toThrow(
        /rowAction "open-drawer" drawer-target "ghost-form" does not resolve to a registered screen/,
      );
    });

    test("drawer-target → screen exists but is not an actionForm → throw with a clear message", () => {
      expect(() =>
        validateBoot([makeFeature({ targetId: "product-list-2", targetType: "entityList" })]),
      ).toThrow(
        /rowAction "open-drawer" drawer-target "product-list-2" is a "entityList" screen, not an actionForm/,
      );
    });
  });

  // --- projectionList rowAction drawer + params prefill ---
  // projectionList is the second list call site; its rowActions run through a
  // different branch of validateScreens than entityList's. The params cases
  // pin the prefill check: a key the target actionForm doesn't declare is
  // dropped by the renderer, so it has to fail at boot instead.
  describe("projectionList rowAction drawer", () => {
    function makeFeature(opts: {
      readonly targetId?: string;
      readonly params?: RowFieldExtractor;
      readonly targetFields?: Record<string, unknown>;
      readonly layoutFields?: readonly string[];
    }) {
      const targetId = opts.targetId ?? "restock-form";
      return defineFeature("shop", (r) => {
        r.queryHandler({
          name: "products",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.writeHandler({
          name: "restock",
          schema: z.object({ qty: z.number() }),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
        r.screen({
          id: "product-projection",
          type: "projectionList",
          query: "shop:query:products",
          columns: ["name"],
          rowActions: [
            {
              kind: "drawer",
              id: "open-drawer",
              label: "actions.restock",
              screen: targetId,
              ...(opts.params !== undefined && { params: opts.params }),
            },
          ],
        });
        r.screen({
          id: "restock-form",
          type: "actionForm",
          handler: "shop:write:restock",
          fields: (opts.targetFields ?? { qty: { type: "number" } }) as never,
          layout: { sections: [{ fields: [...(opts.layoutFields ?? ["qty"])] }] },
        });
      });
    }

    test("drawer-target → registered actionForm → no throw", () => {
      expect(() => validateBoot([makeFeature({})])).not.toThrow();
    });

    test("drawer-target → unknown → throw with a clear message", () => {
      expect(() => validateBoot([makeFeature({ targetId: "ghost-form" })])).toThrow(
        /rowAction "open-drawer" drawer-target "ghost-form" does not resolve to a registered screen/,
      );
    });

    test("params pick a field the target actionForm declares → no throw", () => {
      expect(() => validateBoot([makeFeature({ params: { pick: ["qty"] } })])).not.toThrow();
    });

    test("params pick a field the target actionForm does not declare → throw", () => {
      expect(() => validateBoot([makeFeature({ params: { pick: ["nope"] } })])).toThrow(
        /rowAction "open-drawer" params prefills "nope", which drawer-target "restock-form" does not declare as a field/,
      );
    });

    test("params map to a target key the actionForm does not declare → throw", () => {
      expect(() =>
        validateBoot([makeFeature({ params: { map: { nope: "productQty" } } })]),
      ).toThrow(/params prefills "nope", which drawer-target "restock-form" does not declare/);
    });

    test("params prefill a sensitive target field → throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            params: { pick: ["secret"] },
            targetFields: { secret: { type: "text", sensitive: true } },
            layoutFields: ["secret"],
          }),
        ]),
      ).toThrow(/params prefills "secret", which drawer-target "restock-form" marks as sensitive/);
    });

    test("params prefill a password-format target field → throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            params: { pick: ["pw"] },
            targetFields: { pw: { type: "text", format: "password" } },
            layoutFields: ["pw"],
          }),
        ]),
      ).toThrow(/params prefills "pw", which drawer-target "restock-form" marks as sensitive/);
    });

    test("params prefill a declared field the target layout does not render → throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            params: { pick: ["hidden"] },
            targetFields: { qty: { type: "number" }, hidden: { type: "text" } },
            layoutFields: ["qty"],
          }),
        ]),
      ).toThrow(/params prefills "hidden", which drawer-target "restock-form" does not render/);
    });

    test("params map to a declared target key → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ params: { map: { qty: "productQty" } } })]),
      ).not.toThrow();
    });
  });

  describe("actionForm load", () => {
    function makeLoadFeature(opts: {
      readonly loadQuery: string;
      readonly submitPrefilled?: boolean;
      readonly drawerParams?: RowFieldExtractor;
    }) {
      return defineFeature("shop", (r) => {
        r.queryHandler({
          name: "products",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.queryHandler({
          name: "product:detail",
          schema: z.object({ id: z.string() }),
          handler: async () => ({ id: "p1", name: "Pen" }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.writeHandler({
          name: "rename",
          schema: z.object({ id: z.string(), name: z.string() }),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
        r.screen({
          id: "product-projection",
          type: "projectionList",
          query: "shop:query:products",
          columns: ["name"],
          rowActions: [
            {
              kind: "drawer",
              id: "rename",
              label: "actions.rename",
              screen: "rename-form",
              params: opts.drawerParams ?? { pick: ["id"] },
            },
          ],
        });
        r.screen({
          id: "rename-form",
          type: "actionForm",
          handler: "shop:write:rename",
          fields: { id: { type: "text", required: true }, name: { type: "text", required: true } },
          layout: { sections: [{ fields: [{ field: "id", visible: false }, "name"] }] },
          load: { query: opts.loadQuery },
          ...(opts.submitPrefilled !== undefined && { submitPrefilled: opts.submitPrefilled }),
        });
      });
    }

    test("a registered load query passes boot", () => {
      expect(() =>
        validateBoot([makeLoadFeature({ loadQuery: "shop:query:product:detail" })]),
      ).not.toThrow();
    });

    test("an unknown load query is rejected", () => {
      expect(() => validateBoot([makeLoadFeature({ loadQuery: "shop:query:nope" })])).toThrow(
        /Screen "rename-form" \(actionForm\) load query "shop:query:nope"/,
      );
    });

    test("a load form with submitPrefilled needs no navigate source for a hidden required field", () => {
      expect(() =>
        validateBoot([
          makeLoadFeature({ loadQuery: "shop:query:product:detail", submitPrefilled: true }),
        ]),
      ).not.toThrow();
    });

    test("a drawer passes only the row id: other params keys still need a form field", () => {
      expect(() =>
        validateBoot([
          makeLoadFeature({
            loadQuery: "shop:query:product:detail",
            drawerParams: { pick: ["id", "nope"] },
          }),
        ]),
      ).toThrow(/params prefills "nope"/);
    });
  });

  describe("submitPrefilled on navigate targets", () => {
    type TargetType = "secretMint" | "actionForm";
    function makeFeature(opts: {
      readonly submitPrefilled?: boolean;
      readonly targetType?: TargetType;
      readonly params?: RowFieldExtractor | null;
      readonly targetFields?: Record<string, unknown>;
      readonly layoutFields?: readonly unknown[];
    }) {
      const targetType = opts.targetType ?? "secretMint";
      const params = opts.params === undefined ? { pick: ["id"] } : opts.params;
      return defineFeature("shop", (r) => {
        r.queryHandler({
          name: "products",
          schema: z.object({}),
          handler: async () => ({ rows: [], nextCursor: null }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.writeHandler({
          name: "rotate",
          schema: z.object({ id: z.string() }),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
        r.screen({
          id: "product-projection",
          type: "projectionList",
          query: "shop:query:products",
          columns: ["name"],
          rowActions: [
            {
              kind: "navigate",
              id: "rotate",
              label: "actions.rotate",
              screen: "rotate-form",
              ...(params !== null && { params }),
            },
          ],
        });
        const common = {
          id: "rotate-form",
          handler: "shop:write:rotate",
          fields: (opts.targetFields ?? { id: { type: "text", required: true } }) as never,
          layout: {
            sections: [{ fields: [...(opts.layoutFields ?? [{ field: "id", visible: false }])] }],
          } as never,
          ...(opts.submitPrefilled !== undefined && { submitPrefilled: opts.submitPrefilled }),
        };
        if (targetType === "secretMint") {
          r.screen({
            ...common,
            type: "secretMint",
            reveal: { fields: [{ field: "token", label: "shop:screen:rotate-form.field:token" }] },
          });
        } else {
          r.screen({ ...common, type: "actionForm" });
        }
      });
    }

    for (const targetType of ["secretMint", "actionForm"] as const) {
      test(`${targetType}: params + hidden required field covered → no throw`, () => {
        expect(() =>
          validateBoot([makeFeature({ submitPrefilled: true, targetType })]),
        ).not.toThrow();
      });
    }

    test("params key the target does not declare → throw", () => {
      expect(() =>
        validateBoot([makeFeature({ submitPrefilled: true, params: { pick: ["nope", "id"] } })]),
      ).toThrow(
        /rowAction "rotate" params prefills "nope", which navigate-target "rotate-form" does not declare as a field/,
      );
    });

    test("params key the target layout does not render → throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            submitPrefilled: true,
            params: { pick: ["id", "extra"] },
            targetFields: { id: { type: "text", required: true }, extra: { type: "text" } },
            layoutFields: [{ field: "id", visible: false }],
          }),
        ]),
      ).toThrow(
        /params prefills "extra", which navigate-target "rotate-form" does not render in its layout/,
      );
    });

    test("params key the target marks sensitive → throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            submitPrefilled: true,
            params: { pick: ["id", "secret"] },
            targetFields: {
              id: { type: "text", required: true },
              secret: { type: "text", sensitive: true },
            },
            layoutFields: [{ field: "id", visible: false }, "secret"],
          }),
        ]),
      ).toThrow(/params prefills "secret", which navigate-target "rotate-form" marks as sensitive/);
    });

    test("hidden required field no navigate action passes → throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            submitPrefilled: true,
            params: { pick: ["other"] },
            targetFields: { id: { type: "text", required: true }, other: { type: "text" } },
            layoutFields: [{ field: "id", visible: false }, "other"],
          }),
        ]),
      ).toThrow(
        /Screen "rotate-form" \(secretMint\) sets submitPrefilled but hides required field "id"/,
      );
    });

    test("hidden required field with no navigate source at all → throw", () => {
      expect(() => validateBoot([makeFeature({ submitPrefilled: true, params: null })])).toThrow(
        /hides required field "id"/,
      );
    });

    test("hidden optional field needs no navigate source", () => {
      expect(() =>
        validateBoot([
          makeFeature({
            submitPrefilled: true,
            params: null,
            targetFields: { id: { type: "text" } },
          }),
        ]),
      ).not.toThrow();
    });

    describe("sources that do not run validateRowActionNavigateParams", () => {
      function featureWithDetailSource(
        source: "metric" | "relatedListToolbar",
        params: RowFieldExtractor | undefined,
      ) {
        return defineFeature("shop", (r) => {
          r.queryHandler({
            name: "order:detail",
            schema: z.object({}),
            handler: async () => ({ total: 1 }),
            access: { roles: ["Admin"] },
          });
          r.queryHandler({
            name: "order:items",
            schema: z.object({}),
            handler: async () => ({ rows: [] }),
            access: { roles: ["Admin"] },
          });
          r.writeHandler({
            name: "rotate",
            schema: z.object({ id: z.string() }),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
          r.screen({
            id: "order-detail",
            type: "projectionDetail",
            query: "shop:query:order:detail",
            ...(source === "metric" && {
              metrics: [
                {
                  field: "total",
                  label: "shop:screen:order-detail.metric:total",
                  navigate: { screen: "rotate-form", ...(params && { params }) },
                },
              ],
            }),
            layout: {
              sections:
                source === "metric"
                  ? [{ title: "s", fields: ["total"] }]
                  : [
                      {
                        kind: "relatedList",
                        title: "Items",
                        query: "shop:query:order:items",
                        columns: ["name"],
                        parentParam: "orderId",
                        toolbarActions: [
                          {
                            kind: "navigate",
                            id: "rotate",
                            label: "actions.rotate",
                            screen: "rotate-form",
                            ...(params && { params }),
                          },
                        ],
                      },
                    ],
            },
          });
          r.screen({
            id: "rotate-form",
            type: "secretMint",
            handler: "shop:write:rotate",
            submitPrefilled: true,
            fields: {
              id: { type: "text", required: true },
              secret: { type: "text", sensitive: true },
            } as never,
            layout: {
              sections: [{ fields: [{ field: "id", visible: false }, "secret"] }],
            } as never,
            reveal: { fields: [{ field: "token", label: "shop:screen:rotate-form.field:token" }] },
          });
        });
      }

      test("a metric navigate with a sensitive param key → throw", () => {
        expect(() =>
          validateBoot([featureWithDetailSource("metric", { pick: ["id", "secret"] })]),
        ).toThrow(
          /params prefills "secret", which navigate-target "rotate-form" marks as sensitive/,
        );
      });

      test("a metric navigate with a covering param boots", () => {
        expect(() =>
          validateBoot([featureWithDetailSource("metric", { pick: ["id"] })]),
        ).not.toThrow();
      });

      test("a relatedList toolbarAction without params prefills its implicit parent param → throw when undeclared", () => {
        expect(() =>
          validateBoot([featureWithDetailSource("relatedListToolbar", undefined)]),
        ).toThrow(
          /params prefills "orderId", which navigate-target "rotate-form" does not declare as a field/,
        );
      });
    });

    test("submitPrefilled absent → none of the new checks fire", () => {
      expect(() => validateBoot([makeFeature({ params: { pick: ["nope"] } })])).not.toThrow();
      expect(() => validateBoot([makeFeature({ params: null })])).not.toThrow();
    });

    test("submitPrefilled on an entityEdit screen (untyped schema) → throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-edit",
          type: "entityEdit",
          entity: "product",
          layout: { sections: [{ fields: ["name"] }] },
          submitPrefilled: true,
        } as never);
      });
      expect(() => validateBoot([feature])).toThrow(
        /Screen "product-edit" \(entityEdit\) sets submitPrefilled/,
      );
    });
  });

  // --- defaultSort works for every field type that supports sortable ---
  // `sortable` is supported by multiple field types, not just `TextFieldDef`.
  // The validator checks the `sortable` property on each field definition, so
  // these tests verify the per-field-type path.
  describe("entityList defaultSort: alle sortable-Field-Types", () => {
    function buildFeature(fieldName: string, fields: Record<string, unknown>) {
      return defineFeature("shop", (r) => {
        r.entity({ name: "product", fields: fields as never });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: [{ field: fieldName }],
          defaultSort: { field: fieldName, dir: "asc" },
        });
      });
    }

    test("number field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([buildFeature("rank", { rank: { type: "number", sortable: true } })]),
      ).not.toThrow();
    });

    test("money field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([buildFeature("price", { price: { type: "money", sortable: true } })]),
      ).not.toThrow();
    });

    test("date field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([buildFeature("dueDate", { dueDate: { type: "date", sortable: true } })]),
      ).not.toThrow();
    });

    test("timestamp field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([
          buildFeature("createdAt", { createdAt: { type: "timestamp", sortable: true } }),
        ]),
      ).not.toThrow();
    });

    test("boolean field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([buildFeature("isActive", { isActive: { type: "boolean", sortable: true } })]),
      ).not.toThrow();
    });

    test("select field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([
          buildFeature("status", {
            status: { type: "select", options: ["a", "b"], sortable: true },
          }),
        ]),
      ).not.toThrow();
    });

    test("locatedTimestamp field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([
          buildFeature("pickup", { pickup: { type: "locatedTimestamp", sortable: true } }),
        ]),
      ).not.toThrow();
    });

    test("number field WITHOUT sortable → throws (sortable: true is required)", () => {
      expect(() => validateBootRaw([buildFeature("rank", { rank: { type: "number" } })])).toThrow(
        /is not sortable/,
      );
    });
  });

  // --- screen.id without a dot ---
  // The renderer uses `screen.id` as the URL parameter namespace (`<id>.sort=…`).
  // `defineFeature()` rejects IDs containing `.` through its kebab-case check,
  // before the boot validator runs; this verifies that the authoring API rejects
  // them at its entry point with a clear message.
  describe("screen.id constraints", () => {
    test('screen.id with "." → defineFeature throws (kebab-case)', () => {
      expect(() =>
        defineFeature("shop", (r) => {
          r.entity({
            name: "product",
            ...createEntity({
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }),
          });
          r.screen({
            id: "product.list",
            type: "entityList",
            entity: "product",
            columns: ["name"],
          });
        }),
      ).toThrow(/kebab-case/);
    });

    test("screen.id in kebab-case → no throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
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

  test("allows backing:secrets when system-scoped (dispatch is wired)", () => {
    const feature = defineFeature("billing", (r) => {
      r.config({ keys: { apiKey: createSystemConfig("text", { backing: "secrets" }) } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("a config key without secrets backing boots fine", () => {
    const feature = defineFeature("billing", (r) => {
      r.config({ keys: { apiKey: createSystemConfig("text") } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("navigate with params targeting a dashboard screen without a filter → Throw (params would be a no-op)", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "view",
            label: "actions.view",
            screen: "product-dashboard",
            params: { pick: ["name"] },
          },
        ],
      });
      r.queryHandler({
        name: "count",
        schema: z.object({}),
        handler: async () => ({ total: 0 }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "product-dashboard",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "count",
            label: "Products",
            query: "shop:query:count",
            valueField: "total",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /sets params on navigate-target "product-dashboard" \(dashboard\).*declares no filter.*no-op/,
    );
  });

  test("navigate with params targeting a dashboard screen with a matching filter → no throw (useFilterParams reads it)", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "view",
            label: "actions.view",
            screen: "product-dashboard",
            params: { map: { category: "name" } },
          },
        ],
      });
      r.queryHandler({
        name: "count",
        schema: z.object({}),
        handler: async () => ({ total: 0 }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "product-dashboard",
        type: "dashboard",
        filter: {
          id: "category",
          label: "Category",
          kind: "select",
          options: [{ value: "a", label: "A" }],
        },
        panels: [
          {
            kind: "stat",
            id: "count",
            label: "Products",
            query: "shop:query:count",
            valueField: "total",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("navigate with params targeting a record-bound dashboard without a filter → no throw (record.param is read from the URL)", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "view",
            label: "actions.view",
            screen: "product-dashboard",
            params: { map: { productId: "name" } },
          },
        ],
      });
      r.queryHandler({
        name: "count",
        schema: z.object({}),
        handler: async () => ({ total: 0 }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "product-dashboard",
        type: "dashboard",
        record: { param: "productId" },
        panels: [
          {
            kind: "stat",
            id: "count",
            label: "Products",
            query: "shop:query:count",
            valueField: "total",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("navigate with params targeting a record-bound dashboard whose record.param is not extracted → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "view",
            label: "actions.view",
            screen: "product-dashboard",
            params: { map: { other: "name" } },
          },
        ],
      });
      r.queryHandler({
        name: "count",
        schema: z.object({}),
        handler: async () => ({ total: 0 }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "product-dashboard",
        type: "dashboard",
        record: { param: "productId" },
        panels: [
          {
            kind: "stat",
            id: "count",
            label: "Products",
            query: "shop:query:count",
            valueField: "total",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /URL params are \[productId\].*none of the extracted keys match/,
    );
  });

  test("navigate with params targeting a dashboard screen whose filter id doesn't match any extracted key → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "view",
            label: "actions.view",
            screen: "product-dashboard",
            params: { map: { productName: "name" } },
          },
        ],
      });
      r.queryHandler({
        name: "count",
        schema: z.object({}),
        handler: async () => ({ total: 0 }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "product-dashboard",
        type: "dashboard",
        filter: {
          id: "category",
          label: "Category",
          kind: "select",
          options: [{ value: "a", label: "A" }],
        },
        panels: [
          {
            kind: "stat",
            id: "count",
            label: "Products",
            query: "shop:query:count",
            valueField: "total",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /sets params \[productName\] on navigate-target "product-dashboard" \(dashboard\) whose filter id is "category".*none of the extracted keys match/,
    );
  });

  test("navigate with params targeting a cross-entity entityList screen → no throw (list screens read URL search params for filter-prefill)", () => {
    const feature = defineFeature("housing", (r) => {
      r.entity({
        name: "unit",
        ...createEntity({
          fields: { id: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.entity({
        name: "contract",
        ...createEntity({
          fields: { unitId: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "unit-list",
        type: "entityList",
        entity: "unit",
        columns: ["id"],
        rowActions: [
          {
            kind: "navigate",
            id: "view-contracts",
            label: "actions.viewContracts",
            screen: "contract-list",
            params: { map: { "housing:contract-list.f.unitId": "id" } },
          },
        ],
      });
      r.screen({
        id: "contract-list",
        type: "entityList",
        entity: "contract",
        columns: ["unitId"],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("navigate with params targeting a custom screen → no throw (author owns the component, may read searchParams itself)", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "view",
            label: "actions.view",
            screen: "product-dashboard",
            params: { pick: ["name"] },
          },
        ],
      });
      r.screen({
        id: "product-dashboard",
        type: "custom",
        renderer: { react: "stub" },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("navigate with params targeting a same-entity entityEdit screen → Throw (resolves to update mode)", () => {
    // No explicit entityId + same entity as the source list → the renderer's
    // runNavigate() auto-fills row["id"], landing in EntityEditUpdateBody,
    // which never reads searchParams. Params would silently no-op.
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "open",
            label: "actions.open",
            screen: "product-edit",
            params: { pick: ["name"] },
          },
        ],
      });
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /resolves to UPDATE mode.*same entity "product" auto-fills row\["id"\]/,
    );
  });

  test("navigate with params + explicit entityId targeting an entityEdit screen → Throw (forced update mode)", () => {
    const feature = defineFeature("housing", (r) => {
      r.entity({
        name: "unit",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.entity({
        name: "contract",
        ...createEntity({
          fields: { unitId: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "unit-list",
        type: "entityList",
        entity: "unit",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "edit-contract",
            label: "actions.edit-contract",
            screen: "contract-edit",
            entityId: "name",
            params: { pick: ["name"] },
          },
        ],
      });
      r.screen({
        id: "contract-edit",
        type: "entityEdit",
        entity: "contract",
        layout: { sections: [{ columns: 1, fields: ["unitId"] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /resolves to UPDATE mode \(explicit entityId "name"\)/,
    );
  });

  // The same params-vs-update-mode check as entityList,
  // extended to projectionList rowActions (entityList is covered separately).
  test("projectionList rowAction: navigate with params to an entityEdit target + explicit entityId → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "product-projection",
        type: "projectionList",
        query: "shop:query:products",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "open",
            label: "actions.open",
            screen: "product-edit",
            entityId: "name",
            params: { pick: ["name"] },
          },
        ],
      });
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /\(projectionList\) rowAction "open".*resolves to UPDATE mode \(explicit entityId "name"\)/,
    );
  });

  test("projectionList rowAction: navigate with params to an entityEdit-create target (no entityId) → no throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.queryHandler({
        name: "products",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "product-projection",
        type: "projectionList",
        query: "shop:query:products",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "open",
            label: "actions.open",
            screen: "product-edit",
            params: { pick: ["name"] },
          },
        ],
      });
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("navigate with params targeting a cross-entity entityEdit screen (no explicit entityId) → no throw", () => {
    // The issue's actual use case: a unit row navigates to "create contract"
    // pre-filled with unitId. Different entity + no explicit entityId → the
    // renderer's same-entity row["id"] fallback does NOT fire, so this stays
    // in create mode and EntityEditCreateBody reads the params.
    const feature = defineFeature("housing", (r) => {
      r.entity({
        name: "unit",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.entity({
        name: "contract",
        ...createEntity({
          fields: { unitId: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "unit-list",
        type: "entityList",
        entity: "unit",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "create-contract",
            label: "actions.create-contract",
            screen: "contract-edit",
            params: { map: { unitId: "name" } },
          },
        ],
      });
      r.screen({
        id: "contract-edit",
        type: "entityEdit",
        entity: "contract",
        layout: { sections: [{ columns: 1, fields: ["unitId"] }] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("navigate with params targeting an actionForm screen → no throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.writeHandler({
        name: "create",
        schema: z.object({ name: z.string() }),
        handler: async () => ({ isSuccess: true as const, data: { id: "1" } }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "open-form",
            label: "actions.form",
            screen: "product-form",
            params: { pick: ["name"] },
          },
        ],
      });
      r.screen({
        id: "product-form",
        type: "actionForm",
        handler: "shop:write:create",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});

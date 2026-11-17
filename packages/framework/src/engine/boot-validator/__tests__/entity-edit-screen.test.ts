import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture, withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEmbeddedField, createEmbeddedListField, createEntity, createFilesField, createImagesField, createJsonbField, createMultiSelectField, createTextField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  // An extension section delegates rendering to a feature-provided
  // PlatformComponent resolved by name on the client. Without a react/native
  // marker, the slot would render empty at runtime, so boot must fail instead.
  // Field sections are unaffected.
  describe("entityEdit extension section", () => {
    function makeFeature(component: unknown) {
      return defineFeature("shop", (r) => {
        r.entity(createEntity({
            name: "product",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }));
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

  // layout.mode: "wizard" renders one section per step instead of all
  // sections at once — needs >= 2 sections, each with a title (the step
  // title), or it's a boot-fail instead of a broken step UI.
  describe("entityEdit wizard mode", () => {
    function makeFeature(
      sections: readonly { readonly title?: string; readonly fields: readonly string[] }[],
      mode?: "single" | "wizard",
    ) {
      return defineFeature("shop", (r) => {
        r.entity(createEntity({
            name: "product",
            fields: {
              name: createTextField({ personal: false, reason: "test_fixture" }),
              sku: createTextField({ personal: false, reason: "test_fixture" }),
            },
          }));
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

  // Post-save navigation target, same validation as actionForm's redirect:
  // short screen-ID, same feature, must resolve to a registered screen.
  describe("entityEdit redirect", () => {
    function makeFeature(
      redirect?: string | { readonly screen: string; readonly idFrom: string },
      extraScreens: readonly string[] = [],
      listScreens: readonly string[] = [],
    ) {
      return defineFeature("shop", (r) => {
        r.entity(createEntity({
            name: "product",
            fields: {
              name: createTextField({ personal: false, reason: "test_fixture" }),
              sku: createTextField({ personal: false, reason: "test_fixture" }),
            },
          }));
        for (const list of listScreens) {
          r.screen({
            id: list,
            type: "entityList",
            entity: "product",
            columns: [{ field: "name" }],
          });
        }
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

    test("redirect object with idFrom → custom screen (reads id from route) → no throw", () => {
      expect(() =>
        validateBoot([
          makeFeature({ screen: "product-list", idFrom: "parentId" }, ["product-list"]),
        ]),
      ).not.toThrow();
    });

    test("redirect object with idFrom → screen without an ID (entityList) → throws", () => {
      expect(() =>
        validateBoot([
          makeFeature({ screen: "product-list", idFrom: "parentId" }, [], ["product-list"]),
        ]),
      ).toThrow(
        /redirect\.idFrom is set but target screen "product-list" \(entityList\) carries no id/,
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
          r.entity(createEntity({
              name: "order",
              fields: {
                lines: createEmbeddedField({ note: { type: "text" } }, { required: true }),
              },
            }));
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
          r.entity(createEntity({
              name: "order",
              fields: {
                lines: createEmbeddedField({ note: { type: "text" } }, { required: true }),
              },
            }));
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
          r.entity(createEntity({
              name: "order",
              fields: {
                lines: createEmbeddedField({ note: { type: "text" } }, { required: true }),
              },
            }));
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
          r.entity(createEntity({
              name: "order",
              fields: {
                kind: createTextField({ personal: false, reason: "test_fixture" }),
                lines: createEmbeddedField({ note: { type: "text" } }, { required: true }),
              },
            }));
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
          r.entity(createEntity({ name: "order", fields: { data: createJsonbField() } }));
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

    test("files and images field, screen-spec required: true → no throw (FileListField widget)", async () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "order",
              fields: { attachments: createFilesField(), gallery: createImagesField() },
            }));
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
      await withEnv({ FILE_STORAGE_PROVIDER: "local" }, () => {
        expect(() => validateBoot(features)).not.toThrow();
      });
    });

    test("multiSelect field, entity-level required: true → no throw (has a combobox widget)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "product",
              fields: {
                tags: createMultiSelectField({ options: ["a", "b"] as const, required: true }),
              },
            }));
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
          r.entity(createEntity({
              name: "invoice",
              fields: {
                lines: createEmbeddedListField({ note: { type: "text" } }, { required: true }),
              },
            }));
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

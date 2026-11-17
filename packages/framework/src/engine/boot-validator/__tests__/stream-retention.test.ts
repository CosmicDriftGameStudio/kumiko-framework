import { describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import * as z from "zod";
import { buildEntityTable } from "../../../db/table-builder.ts";
import { plaintextText } from "../../__tests__/plaintext-fields.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createFileField, createTextField } from "../../factories.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { validateStreamRetention } from "../stream-retention.ts";

type EntityOverrides = Partial<
  Pick<EntityDefinition, "streamRetention" | "retention" | "systemStream" | "idType">
>;

function previewFeature(
  overrides: EntityOverrides = {},
  extraFields: Record<string, ReturnType<typeof createFileField>> = {},
): FeatureDefinition {
  return defineFeature("previews", (r) => {
    r.entity({
      name: "preview",
      ...createEntity({
        table: "read_sr_guard_previews",
        fields: { title: plaintextText, ...extraFields },
        streamRetention: { keepFor: "30d" },
        ...overrides,
      }),
    });
  });
}

describe("validateStreamRetention", () => {
  test("a plain entity with streamRetention passes", () => {
    const feature = previewFeature();
    expect(() => validateStreamRetention(feature, [feature])).not.toThrow();
  });

  test("an unparsable keepFor fails the boot", () => {
    const feature = previewFeature({ streamRetention: { keepFor: "30 days" } });
    expect(() => validateStreamRetention(feature, [feature])).toThrow(/keepFor="30 days"/);
  });

  test("streamRetention together with retention fails", () => {
    const feature = previewFeature({ retention: { keepFor: "30d", strategy: "hardDelete" } });
    expect(() => validateStreamRetention(feature, [feature])).toThrow(/and retention/);
  });

  test("a serial id entity fails", () => {
    const feature = previewFeature({ idType: "serial" });
    expect(() => validateStreamRetention(feature, [feature])).toThrow(/idType "serial"/);
  });

  test("a systemStream entity fails", () => {
    const feature = previewFeature({ systemStream: true });
    expect(() => validateStreamRetention(feature, [feature])).toThrow(/systemStream/);
  });

  test("a file field fails", () => {
    const feature = previewFeature({}, { attachment: createFileField() });
    expect(() => validateStreamRetention(feature, [feature])).toThrow(
      /field "attachment" holds files/,
    );
  });

  test("a foreign r.projection over the entity's events fails, naming it", () => {
    const feature = previewFeature();
    const readerEntity = createEntity({
      table: "read_sr_guard_counts",
      fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
    });
    const reader = defineFeature("readers", (r) => {
      r.entity({ name: "preview-count", ...readerEntity });
      const touched = r.defineEvent("preview-touched", z.object({}), { piiFields: "none" });
      r.projection({
        name: "preview-count",
        source: "preview",
        table: buildEntityTable("preview-count", readerEntity),
        apply: { [touched.name]: async () => {} },
      });
    });
    expect(() => validateStreamRetention(feature, [feature, reader])).toThrow(
      /r\.projection "preview-count"/,
    );
  });
});

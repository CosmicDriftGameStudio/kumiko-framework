// A `personal` jsonb field is stored as a ciphertext JSON string — the boot
// validator must refuse every use that reads inside the column.

import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createJsonbField, createTextField } from "../factories.js";
import type { EntityIndexDef, FieldDefinition } from "../types/index.js";

function bootWith(
  fields: Record<string, FieldDefinition>,
  indexes?: readonly EntityIndexDef[],
): void {
  const feature = defineFeature("test", (r) => {
    r.entity(
      "golden",
      createEntity({
        table: "boot_jsonb_goldens",
        fields: {
          label: createTextField({ personal: false, reason: "test_fixture" }),
          ...fields,
        },
        ...(indexes && { indexes }),
      }),
    );
  });
  validateBoot([feature]);
}

describe("personal jsonb field boot guard", () => {
  test("a plain personal jsonb field boots", () => {
    expect(() => bootWith({ input: createJsonbField({ personal: "tenant" }) })).not.toThrow();
  });

  test("an unannotated jsonb field may be indexed", () => {
    expect(() =>
      bootWith({ input: createJsonbField({ personal: false, reason: "test_fixture" }) }, [
        { columns: ["label", "input"] },
      ]),
    ).not.toThrow();
  });

  test("a personal jsonb field in an entity index throws", () => {
    expect(() =>
      bootWith({ input: createJsonbField({ personal: "tenant" }) }, [{ columns: ["input"] }]),
    ).toThrow(/personal jsonb field used in an entity index/);
  });

  test.each(["sortable", "filterable", "searchable", "lookupable"] as const)(
    "a personal jsonb field with %s throws",
    (flag) => {
      expect(() =>
        bootWith({ input: { ...createJsonbField({ personal: "tenant" }), [flag]: true } }),
      ).toThrow(new RegExp(flag === "lookupable" ? "blind-index" : flag));
    },
  );

  test("personal on the custom-fields column throws", () => {
    expect(() => bootWith({ customFields: createJsonbField({ personal: "tenant" }) })).toThrow(
      /custom-fields jsonb column/,
    );
  });
});

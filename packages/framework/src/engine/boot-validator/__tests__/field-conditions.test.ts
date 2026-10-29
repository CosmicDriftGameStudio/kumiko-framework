import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature.ts";
import { createTextField } from "../../factories.ts";
import type {
  EmbeddedSubFieldDef,
  EntityFieldDefinition,
  FieldDefinition,
  FieldStateConditions,
} from "../../types/fields.ts";
import { validateFieldConditions } from "../field-conditions.ts";
import { validateBoot } from "../index.ts";

function text(extra: FieldStateConditions & { required?: boolean }): EntityFieldDefinition {
  return createTextField({ personal: false, reason: "test_fixture", ...extra });
}

function validate(fields: Record<string, EntityFieldDefinition>): void {
  const feature = defineFeature("t", (r) => {
    r.entity({ name: "thing", fields });
  });
  validateFieldConditions(feature);
}

function embedded(
  schema: Extract<FieldDefinition, { type: "embedded" }>["schema"],
  rest: Partial<Extract<FieldDefinition, { type: "embedded" }>> = {},
): EntityFieldDefinition {
  return { type: "embedded", multiple: true, schema, ...rest };
}

describe("top-level visibleWhen / requiredWhen", () => {
  const status: EntityFieldDefinition = { type: "select", options: ["a", "b"] };

  test("accepts a valid condition", () => {
    expect(() =>
      validate({ status, note: text({ requiredWhen: { field: "status", eq: "a" } }) }),
    ).not.toThrow();
  });

  test("rejects an unknown condition field", () => {
    expect(() => validate({ note: text({ visibleWhen: { field: "nope", eq: "a" } }) })).toThrow(
      /not a field of the entity/,
    );
  });

  test("validateBoot runs the condition check", () => {
    const feature = defineFeature("t", (r) => {
      r.entity({
        name: "thing",
        fields: { note: text({ visibleWhen: { field: "nope", eq: "a" } }) },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/not a field of the entity/);
  });

  test("rejects a condition on its own field", () => {
    expect(() => validate({ note: text({ requiredWhen: { field: "note", eq: "a" } }) })).toThrow(
      /own field/,
    );
  });

  test("rejects a condition field of an unsupported type", () => {
    expect(() =>
      validate({
        when: { type: "timestamp" },
        note: text({ visibleWhen: { field: "when", eq: "a" } }),
      }),
    ).toThrow(/plain scalar/);
  });

  test("rejects select comparison values that are not options", () => {
    expect(() =>
      validate({
        status,
        note: text({ visibleWhen: { field: "status", in: ["a", "z"] } }),
      }),
    ).toThrow(/"z" which is not an option/);
  });

  test("rejects required: true with requiredWhen or visibleWhen", () => {
    expect(() =>
      validate({
        status,
        note: text({ required: true, requiredWhen: { field: "status", eq: "a" } }),
      }),
    ).toThrow(/required: true together with requiredWhen/);
    expect(() =>
      validate({
        status,
        note: text({ required: true, visibleWhen: { field: "status", eq: "a" } }),
      }),
    ).toThrow(/required: true together with visibleWhen/);
  });
});

describe("embedded sub-field conditions", () => {
  test("accepts sibling conditions", () => {
    expect(() =>
      validate({
        rows: embedded({
          result: { type: "select", options: ["ok", "bad"] },
          note: { type: "text", requiredWhen: { field: "result", eq: "bad" } },
        }),
      }),
    ).not.toThrow();
  });

  test("rejects non-sibling, self, non-scalar and bad option values", () => {
    expect(() =>
      validate({ rows: embedded({ note: { type: "text", visibleWhen: { field: "x", eq: 1 } } }) }),
    ).toThrow(/not a sub-field of the same row/);
    expect(() =>
      validate({
        rows: embedded({ note: { type: "text", visibleWhen: { field: "note", eq: 1 } } }),
      }),
    ).toThrow(/own sub-field/);
    expect(() =>
      validate({
        rows: embedded({
          photos: { type: "images" },
          note: { type: "text", visibleWhen: { field: "photos", eq: 1 } },
        }),
      }),
    ).toThrow(/cannot be compared/);
    expect(() =>
      validate({
        rows: embedded({
          result: { type: "select", options: ["ok", "bad"] },
          note: { type: "text", visibleWhen: { field: "result", eq: "zzz" } },
        }),
      }),
    ).toThrow(/"zzz" which is not an option/);
  });

  test("rejects required: true with a condition", () => {
    expect(() =>
      validate({
        rows: embedded({
          a: { type: "boolean" },
          note: { type: "text", required: true, requiredWhen: { field: "a", eq: true } },
        }),
      }),
    ).toThrow(/required: true together with requiredWhen/);
  });
});

describe("embedded derived cells", () => {
  test("numeric op needs numeric target and sources", () => {
    expect(() =>
      validate({
        rows: embedded(
          { qty: { type: "number" }, price: { type: "number" }, total: { type: "number" } },
          { derived: { total: { op: "multiply", from: ["qty", "price"] } } },
        ),
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        rows: embedded(
          { qty: { type: "number" }, total: { type: "text" } },
          { derived: { total: { op: "sum", from: ["qty"] } } },
        ),
      }),
    ).toThrow(/target must be a number, decimal or money/);
    expect(() =>
      validate({
        rows: embedded(
          { qty: { type: "text" }, total: { type: "number" } },
          { derived: { total: { op: "sum", from: ["qty"] } } },
        ),
      }),
    ).toThrow(/not a number, decimal or money/);
  });

  const rangeSchema = {
    measured: { type: "number" },
    min: { type: "number" },
    max: { type: "number" },
    kind: { type: "select", options: ["check", "measurement"] },
    result: { type: "select", options: ["ok", "not_ok"] },
  } as const;

  test("inRange accepts a valid declaration", () => {
    expect(() =>
      validate({
        rows: embedded(rangeSchema, {
          derived: {
            result: {
              op: "inRange",
              from: ["measured", "min", "max"],
              inside: "ok",
              outside: "not_ok",
              when: { field: "kind", eq: "measurement" },
            },
          },
        }),
      }),
    ).not.toThrow();
  });

  test("inRange rejects wrong source count, target and missing options", () => {
    const build = (from: string[], inside: string, outside: string, target: string = "result") =>
      validate({
        rows: embedded(rangeSchema, {
          derived: { [target]: { op: "inRange", from, inside, outside } },
        }),
      });
    expect(() => build(["measured", "min"], "ok", "not_ok")).toThrow(/exactly three sources/);
    expect(() => build(["measured", "min", "max"], "ok", "other")).toThrow(
      /target must be a select/,
    );
    expect(() => build(["measured", "min", "max"], "ok", "not_ok", "min")).toThrow(
      /target must be a select/,
    );
  });

  test("when must read a stored sibling scalar, not a derived cell", () => {
    expect(() =>
      validate({
        rows: embedded(rangeSchema, {
          derived: {
            result: {
              op: "inRange",
              from: ["measured", "min", "max"],
              inside: "ok",
              outside: "not_ok",
              when: { field: "result", eq: "ok" },
            },
          },
        }),
      }),
    ).toThrow(/own sub-field|derived cell/);
  });
});

describe("embedded file sub-fields", () => {
  test("accepts images and files", () => {
    expect(() =>
      validate({
        rows: embedded({
          photos: {
            type: "images",
            maxCount: 3,
            maxSize: "5mb",
            accept: ["jpg"],
            capture: "environment",
          },
          docs: { type: "files" },
        }),
      }),
    ).not.toThrow();
  });

  test("rejects searchable, bad maxCount, bad maxSize, empty accept entry", () => {
    const sub = (photos: Extract<EmbeddedSubFieldDef, { type: "images" | "files" }>) =>
      validate({ rows: embedded({ photos }) });
    expect(() => sub({ type: "images", searchable: true })).toThrow(/cannot be searchable/);
    expect(() => sub({ type: "images", maxCount: 0 })).toThrow(/maxCount/);
    expect(() => sub({ type: "images", maxCount: 1.5 })).toThrow(/maxCount/);
    expect(() => sub({ type: "files", maxSize: "lots" })).toThrow(/maxSize/);
    expect(() => sub({ type: "files", accept: [""] })).toThrow(/accept/);
  });

  test("rejects use in derived or totals", () => {
    expect(() =>
      validate({
        rows: embedded(
          { photos: { type: "images" }, total: { type: "number" } },
          { totals: ["photos"] },
        ),
      }),
    ).toThrow(/file sub-field "photos"/);
  });
});

describe("select sub-field optionTones", () => {
  test("keys must be options", () => {
    expect(() =>
      validate({
        rows: embedded({ result: { type: "select", options: ["ok"], optionTones: { ok: "ok" } } }),
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        rows: embedded({
          result: { type: "select", options: ["ok"], optionTones: { bad: "bad" } },
        }),
      }),
    ).toThrow(/optionTones\["bad"\]/);
  });
});

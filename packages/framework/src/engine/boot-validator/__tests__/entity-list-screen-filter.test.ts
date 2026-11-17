import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

// Three layers of author-code validation: the field exists, `filterable: true`
// is set, and the operator matches the field type. A boot failure is preferable
// to a silently empty bucket or a Drizzle crash at runtime.
describe("entityList screen-filter", () => {
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

  test("filter.op=lt on text field → Throw (op vs. type compatibility)", () => {
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

  test("filter.op=lte on text field → Throw (op vs. type compatibility)", () => {
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

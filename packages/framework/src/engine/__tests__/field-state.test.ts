import { describe, expect, test } from "bun:test";
import {
  findMissingConditionalRequirements,
  isFieldRequired,
  isFieldVisible,
  isMissingRequiredValue,
} from "../field-state.ts";
import type { FieldDefinition } from "../types/fields.ts";

describe("isMissingRequiredValue", () => {
  test("undefined, null, empty string and empty array are missing", () => {
    for (const value of [undefined, null, "", []]) expect(isMissingRequiredValue(value)).toBe(true);
    for (const value of [0, false, "x", [1]]) expect(isMissingRequiredValue(value)).toBe(false);
  });
});

describe("isFieldVisible / isFieldRequired", () => {
  const def = {
    visibleWhen: { field: "kind", eq: "a" },
    requiredWhen: { field: "kind", eq: "a" },
  } as const;

  test("no visibleWhen is always visible", () => {
    expect(isFieldVisible({}, {})).toBe(true);
  });

  test("a hidden field is never required", () => {
    expect(isFieldRequired({ required: true, ...def }, { kind: "b" })).toBe(false);
    expect(isFieldRequired(def, { kind: "a" })).toBe(true);
  });

  test("requiredWhen alone needs its condition", () => {
    expect(isFieldRequired({ requiredWhen: { field: "kind", eq: "a" } }, { kind: "b" })).toBe(
      false,
    );
  });
});

describe("findMissingConditionalRequirements", () => {
  const fields: Record<string, FieldDefinition> = {
    result: { type: "select", options: ["ok", "not_ok"] },
    finding: { type: "text", requiredWhen: { field: "result", eq: "not_ok" } },
    rows: {
      type: "embedded",
      multiple: true,
      schema: {
        result: { type: "select", options: ["ok", "not_ok"] },
        note: {
          type: "text",
          visibleWhen: { field: "result", eq: "not_ok" },
          requiredWhen: { field: "result", eq: "not_ok" },
        },
      },
    },
    single: {
      type: "embedded",
      schema: {
        flag: { type: "boolean" },
        why: { type: "text", requiredWhen: { field: "flag", eq: true } },
      },
    },
  };

  test("top-level field is reported while its condition holds", () => {
    expect(findMissingConditionalRequirements(fields, { result: "not_ok" })).toEqual(["finding"]);
    expect(findMissingConditionalRequirements(fields, { result: "ok" })).toEqual([]);
    expect(findMissingConditionalRequirements(fields, { result: "not_ok", finding: "x" })).toEqual(
      [],
    );
  });

  test("embedded list rows report index paths", () => {
    const values = {
      rows: [{ result: "ok" }, { result: "not_ok" }, { result: "not_ok", note: "x" }],
    };
    expect(findMissingConditionalRequirements(fields, values)).toEqual(["rows.1.note"]);
  });

  test("single embedded object reports without index", () => {
    expect(findMissingConditionalRequirements(fields, { single: { flag: true } })).toEqual([
      "single.why",
    ]);
  });

  test("a hidden embedded field skips its rows", () => {
    const hidden: Record<string, FieldDefinition> = {
      rows: { ...(fields["rows"] as FieldDefinition), visibleWhen: { field: "show", eq: true } },
    };
    expect(
      findMissingConditionalRequirements(hidden, { show: false, rows: [{ result: "not_ok" }] }),
    ).toEqual([]);
  });

  test("with previous, unchanged values stay editable", () => {
    const previous = { result: "not_ok", rows: [{ result: "not_ok" }] };
    expect(findMissingConditionalRequirements(fields, { ...previous, other: 1 }, previous)).toEqual(
      [],
    );
    expect(
      findMissingConditionalRequirements(fields, { ...previous, result: "ok" }, previous),
    ).toEqual([]);
    expect(
      findMissingConditionalRequirements(
        fields,
        { result: "not_ok", rows: [{ result: "not_ok", x: 1 }] },
        previous,
      ),
    ).toEqual(["rows.0.note"]);
  });
});

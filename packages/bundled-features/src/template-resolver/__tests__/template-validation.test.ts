import { describe, expect, test } from "bun:test";
import { templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import { validateTemplatePlaceholders, variablesFromSchema } from "../template-validation";

const variables = {
  name: templateVariable.text({ required: true }),
  total: templateVariable.money(),
  lines: templateVariable.list({ label: templateVariable.text() }),
};

function validate(body: string, meta: { subject: string; previewText?: string } | null = null) {
  return validateTemplatePlaceholders({ kind: "mail", body, meta, variables });
}

describe("validateTemplatePlaceholders", () => {
  test("declared variables are used, system placeholders and logo are always allowed", () => {
    const result = validate(
      '<p><span data-variable="name"></span> <span data-variable="tenantName"></span></p><img data-resource="logo" src="x">',
    );
    expect(result).toEqual({ unknown: [], missingRequired: [], used: ["name"] });
  });

  test("unknown variables, link placeholders and resources are reported", () => {
    const result = validate(
      '<span data-variable="nope"></span><a href="{{gone}}">x</a><img data-resource="other">',
    );
    expect(result.unknown).toEqual(["gone", "nope", "other"]);
  });

  test("missing required variables are listed", () => {
    expect(validate("<p>x</p>").missingRequired).toEqual(["name"]);
  });

  test("list rows count the list as used and item fields as known", () => {
    const result = validate(
      '<span data-variable="name"></span><table><tr data-each="lines"><td><span data-variable="label"></span></td></tr></table>',
    );
    expect(result.unknown).toEqual([]);
    expect(result.used).toEqual(["lines", "name"]);
  });

  test("an each row for a non-list is unknown", () => {
    expect(validate('<table><tr data-each="name"><td>x</td></tr></table>').unknown).toEqual([
      "name",
    ]);
  });

  test("meta placeholders are checked; only plain expressions are allowed", () => {
    expect(validate("<p>x</p>", { subject: "Hi {{name}}" }).used).toEqual(["name"]);
    expect(validate("<p>x</p>", { subject: "Hi {{nope}}" }).unknown).toEqual(["nope"]);
    expect(validate("<p>x</p>", { subject: "{{#each lines}}" }).unknown).not.toEqual([]);
    expect(validate("<p>x</p>", { subject: "{{{name}}}" }).unknown).not.toEqual([]);
  });

  test("prototype names are not declared variables", () => {
    expect(validate('<span data-variable="constructor"></span>').unknown).toEqual(["constructor"]);
  });
});

describe("variablesFromSchema", () => {
  test("bare strings are legacy text variables, junk is dropped", () => {
    expect(variablesFromSchema({ a: "string", b: { type: "money" }, c: 42 })).toEqual({
      a: { type: "text" },
      b: { type: "money" },
    });
  });
});

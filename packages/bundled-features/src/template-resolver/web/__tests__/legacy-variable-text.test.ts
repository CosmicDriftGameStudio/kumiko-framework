import { describe, expect, test } from "bun:test";
import { convertLegacyVariableText } from "../legacy-variable-text.ts";

describe("convertLegacyVariableText", () => {
  test("turns a text placeholder into a variable node", () => {
    expect(convertLegacyVariableText("<p>Hallo {{customerName}}</p>")).toBe(
      '<p>Hallo <span data-variable="customerName"></span></p>',
    );
  });

  test("converts several placeholders, including spaced and dotted names", () => {
    expect(convertLegacyVariableText("<p>{{ a }} und {{lines.label}}, {{b}}</p>")).toBe(
      '<p><span data-variable="a"></span> und <span data-variable="lines.label"></span>, <span data-variable="b"></span></p>',
    );
  });

  test("leaves an invalid name as text", () => {
    const html = "<p>{{a b}} {{1x}} {{constructor.prototype}} {{}}</p>";
    expect(convertLegacyVariableText(html)).toBe(html);
  });

  test("leaves a variable in an attribute alone", () => {
    const html = '<p><a href="{{url}}" title="x > {{name}}">go</a></p>';
    expect(convertLegacyVariableText(html)).toBe(html);
  });

  test("leaves block helpers and raw output alone", () => {
    const html =
      "<p>{{#if name}}Hi{{else}}Bye{{/if}} {{{raw}}}</p>{{#each lines}}<p>x</p>{{/each}}";
    expect(convertLegacyVariableText(html)).toBe(html);
  });

  test("treats a long run of unclosed angle brackets as text and still converts the variable", () => {
    const run = "<".repeat(20_000);
    expect(convertLegacyVariableText(`${run}{{name}}`)).toBe(
      `${run}<span data-variable="name"></span>`,
    );
  });

  test("is idempotent", () => {
    const once = convertLegacyVariableText("<p>{{name}}</p>");
    expect(convertLegacyVariableText(once)).toBe(once);
  });
});

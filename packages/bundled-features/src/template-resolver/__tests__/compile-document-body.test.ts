import { describe, expect, test } from "bun:test";
import { templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import Handlebars from "handlebars";
import { compileDocumentBodyToHandlebars } from "../compile-document-body";

const variables = {
  name: templateVariable.text(),
  total: templateVariable.money(),
  due: templateVariable.date(),
  url: templateVariable.link(),
  lines: templateVariable.list({
    label: templateVariable.text(),
    price: templateVariable.money(),
  }),
};

function compile(html: string): string {
  return compileDocumentBodyToHandlebars(html, variables);
}

describe("compileDocumentBodyToHandlebars", () => {
  test("variables become escaped expressions, money and date use their helper", () => {
    const out = compile(
      '<p><span data-variable="name"></span> <span data-variable="total"></span> <span data-variable="due"></span></p>',
    );
    expect(out).toContain("{{name}}");
    expect(out).toContain("{{money total}}");
    expect(out).toContain("{{date due}}");
  });

  test("link placeholders become the link helper", () => {
    expect(compile('<a href="{{url}}">go</a>')).toContain('href="{{link url}}"');
  });

  test("list rows are wrapped in each and item fields stay local while root names use @root", () => {
    const out = compile(
      '<table><tr data-each="lines"><td><span data-variable="label"></span></td><td><span data-variable="name"></span></td></tr></table>',
    );
    expect(out).toContain("{{#each lines}}");
    expect(out).toContain("{{/each}}");
    expect(out).toContain("{{label}}");
    expect(out).toContain("{{@root.name}}");
  });

  test("a row for an undeclared list is dropped", () => {
    expect(compile('<table><tr data-each="evil"><td>x</td></tr></table>')).not.toContain("evil");
  });

  test("author-typed Handlebars syntax is inert text, never an expression", () => {
    const out = compile("<p>{{{raw}}} {{constructor}} {{#each lines}}x{{/each}}</p>");
    expect(out).not.toContain("{{");
    expect(out).not.toContain("}}");
    const rendered = Handlebars.create().compile(out)({ raw: "SECRET", constructor: "SECRET" });
    expect(rendered).not.toContain("SECRET");
    expect(rendered).toContain("&#123;&#123;&#123;raw");
  });

  test("marker characters in author text cannot smuggle expressions", () => {
    const out = compile("<p>0</p>");
    const rendered = Handlebars.create().compile(out)({});
    expect(rendered).not.toContain("name");
  });

  test("event handlers and scripts are stripped, unsafe hrefs neutralized", () => {
    const out = compile('<p onclick="x()">a</p><script>x()</script><a href="javascript:x()">b</a>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("script");
    expect(out).not.toContain("javascript:");
  });

  test("unknown variable references compile to nothing dangerous", () => {
    const out = compile('<span data-variable="__proto__"></span>');
    expect(out).not.toContain("__proto__");
  });
});

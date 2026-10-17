import { describe, expect, test } from "bun:test";
import { templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import Handlebars from "handlebars";
import {
  collectDocumentResourceKeys,
  compileDocumentBodyToHandlebars,
  toResourceDataUri,
} from "../compile-document-body";
import { mailLayoutAppearance } from "../layout-appearance";

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
  test("underlined text keeps its <u> element", () => {
    expect(compile("<p>a <u>b</u></p>")).toContain("<u>b</u>");
  });

  test("variables become escaped expressions, money and date use their helper", () => {
    const out = compile(
      '<p><span data-variable="name"></span> <span data-variable="total"></span> <span data-variable="due"></span></p>',
    );
    expect(out).toContain("{{name}}");
    expect(out).toContain("{{money total}}");
    expect(out).toContain("{{date due}}");
  });

  test("data-align is kept for print and becomes an inline style for mail", () => {
    const html = '<p data-align="center">x</p><h1 data-align="bogus">y</h1>';
    expect(compile(html)).toContain('<p data-align="center">');
    expect(compileDocumentBodyToHandlebars(html, variables, { alignmentAsInlineStyle: true })).toBe(
      '<p style="text-align:center">x</p><h1>y</h1>',
    );
  });

  test("a resource image gets an inline width cap for mail only", () => {
    const html = '<p><img data-resource="logo" alt="x"></p>';
    const resourceSrc = () => "cid:logo";
    expect(compileDocumentBodyToHandlebars(html, variables, { resourceSrc })).not.toContain(
      "max-width",
    );
    expect(
      compileDocumentBodyToHandlebars(html, variables, {
        resourceSrc,
        resourceImageMaxWidthPx: 180,
      }),
    ).toContain('style="max-width:180px;height:auto"');
    expect(
      compileDocumentBodyToHandlebars(html, variables, {
        resourceSrc,
        resourceImageMaxWidthPx: 180,
        resourceImageMaxHeightPx: 64,
      }),
    ).toContain('style="max-width:180px;max-height:64px;width:auto;height:auto"');
  });

  test("table cells get padding inline for mail only and keep their alignment", () => {
    const html =
      '<table><tr><th><p>Item</p></th><td data-align="right">Rent</td></tr></table><p data-size="small" data-align="right">x</p>';
    expect(compile(html)).not.toContain("padding");
    const out = compileDocumentBodyToHandlebars(html, variables, {
      alignmentAsInlineStyle: true,
      tableAsInlineStyle: true,
    });
    expect(out).toContain('<table style="width:100%;border-collapse:collapse">');
    expect(out).toContain('<th style="padding:6px 12px;');
    expect(out).toContain('<td style="text-align:right;padding:6px 12px;');
    expect(out).toContain('<p style="text-align:right;font-size:13px;color:#4A515E">x</p>');
  });

  test("a data-button link gets button styling inline for mail only", () => {
    const html = '<a data-button href="https://example.com">go</a>';
    expect(compile(html)).not.toContain("style=");
    expect(
      compileDocumentBodyToHandlebars(html, variables, { buttonAsInlineStyle: true }),
    ).toContain("background-color:");
  });

  test("the layout button style replaces the default button look", () => {
    const html = '<a data-button href="https://example.com">go</a>';
    const out = compileDocumentBodyToHandlebars(html, variables, {
      buttonAsInlineStyle: true,
      buttonInlineStyle: mailLayoutAppearance({ buttonStyle: "outline" }).buttonStyle,
    });
    expect(out).toContain("border:2px solid #1f5468");
    expect(out).not.toContain("background-color:#1f5468");
  });

  test("buttons take the branding accent only when the layout opts into the branding accent", () => {
    expect(mailLayoutAppearance({ accentLine: "branding" }, "#ab12cd").buttonStyle).toContain(
      "background-color:#ab12cd",
    );
    expect(mailLayoutAppearance({ accentLine: "none" }, "#ab12cd").buttonStyle).toContain(
      "background-color:#1f5468",
    );
    expect(
      mailLayoutAppearance({ accentLine: "branding" }, 'red;background:url("x")').buttonStyle,
    ).not.toContain("url(");
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

  test("a line with only an empty optional placeholder renders nothing, a filled one renders", () => {
    const template = Handlebars.create().compile(
      compile('<p>Hello</p><p><span data-variable="name"></span></p>'),
    );
    expect(template({})).toBe("<p>Hello</p>");
    expect(template({ name: "" })).toBe("<p>Hello</p>");
    expect(template({ name: "Ada" })).toBe("<p>Hello</p><p>Ada</p>");
  });

  test("an amount of 0 keeps its placeholder-only line", () => {
    const hbs = Handlebars.create();
    hbs.registerHelper("money", (value: unknown) => `${String(value)} EUR`);
    const template = hbs.compile(compile('<h2><span data-variable="total"></span></h2>'));
    expect(template({ total: 0 })).toBe("<h2>0 EUR</h2>");
    expect(template({})).toBe("");
  });

  test("lines with static text, an image or two placeholders are never wrapped", () => {
    expect(compile('<p>Dear <span data-variable="name"></span></p>')).not.toContain("{{#if");
    expect(
      compileDocumentBodyToHandlebars(
        '<p><img data-resource="logo" alt=""><span data-variable="name"></span></p>',
        variables,
        { resourceSrc: () => "cid:logo" },
      ),
    ).not.toContain("{{#if");
    expect(
      compile('<p><span data-variable="name"></span> <span data-variable="due"></span></p>'),
    ).not.toContain("{{#if");
  });

  test("a placeholder-only line inside a list row checks the row field, not the root", () => {
    const out = compile(
      '<table><tr data-each="lines"><td><p><span data-variable="label"></span></p><p><span data-variable="name"></span></p></td></tr></table>',
    );
    expect(out).toContain("{{#if label includeZero=true}}<p>{{label}}</p>{{/if}}");
    expect(out).toContain("{{#if @root.name includeZero=true}}<p>{{@root.name}}</p>{{/if}}");
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

describe("document resources", () => {
  const body = '<p>a</p><img data-resource="logo" alt="Logo"><img data-resource="sig">';

  test("resourceSrc sets src, drops data-resource and keeps alt", () => {
    const out = compileDocumentBodyToHandlebars(body, variables, {
      resourceSrc: (key) => (key === "logo" ? "cid:logo" : undefined),
    });
    expect(out).toContain('src="cid:logo"');
    expect(out).toContain('alt="Logo"');
    expect(out).not.toContain("data-resource");
  });

  test("a key without a source removes the image, as does omitting resourceSrc", () => {
    const withoutSource = compileDocumentBodyToHandlebars(body, variables, {
      resourceSrc: () => undefined,
    });
    expect(withoutSource).not.toContain("<img");
    expect(compile(body)).not.toContain("<img");
  });

  test("collectDocumentResourceKeys returns unique valid keys in document order", () => {
    expect(
      collectDocumentResourceKeys(
        '<img data-resource="b"><img data-resource="a"><img data-resource="b"><img data-resource="bad key"><img src="x">',
      ),
    ).toEqual(["b", "a"]);
  });

  test("toResourceDataUri encodes raster images and rejects svg", () => {
    expect(toResourceDataUri("image/png", new Uint8Array([1, 2, 3]))).toBe(
      "data:image/png;base64,AQID",
    );
    expect(() => toResourceDataUri("image/svg+xml", new Uint8Array([1]))).toThrow();
  });
});

describe("compileDocumentBodyToHandlebars :: richText", () => {
  test("a richText variable becomes the richText helper, a text variable stays escaped", () => {
    const out = compileDocumentBodyToHandlebars(
      '<p><span data-variable="note"></span> <span data-variable="name"></span></p>',
      { note: templateVariable.richText(), name: templateVariable.text() },
    );
    expect(out).toContain("{{richText note inline=true}}");
    expect(out).toContain("{{name}}");
  });

  test("a paragraph holding only a richText variable becomes a div that keeps its attributes", () => {
    const out = compileDocumentBodyToHandlebars(
      '<p data-size="small"><span data-variable="note"></span></p>',
      { note: templateVariable.richText() },
      { alignmentAsInlineStyle: true },
    );
    expect(out).toBe(
      '{{#if note includeZero=true}}<div style="font-size:13px;color:#4A515E">{{richText note}}</div>{{/if}}',
    );
  });

  test("a heading holding only a richText variable renders it inline", () => {
    const out = compileDocumentBodyToHandlebars('<h2><span data-variable="note"></span></h2>', {
      note: templateVariable.richText(),
    });
    expect(out).toBe("{{#if note includeZero=true}}<h2>{{richText note inline=true}}</h2>{{/if}}");
  });
});

describe("compileDocumentBodyToHandlebars :: steps block", () => {
  const steps =
    '<div data-steps="stage"><span data-step="reported">Gemeldet</span><span data-step="resolved">Behoben {{x}}</span></div>';

  test("a steps block becomes an inline-styled table whose state comes from the stepIs helper", () => {
    const out = compileDocumentBodyToHandlebars(steps, variables, { stepsColor: "#F2B53A" });
    expect(out).toContain('<table role="presentation"');
    expect(out).toContain(
      '{{#stepIs stage 0 "reported,resolved" "reached"}}#F2B53A{{else}}#ECEDEA{{/stepIs}}',
    );
    expect(out).toContain(
      '{{#stepIs stage 1 "reported,resolved" "current"}}600{{else}}400{{/stepIs}}',
    );
    expect(out).toContain(">Gemeldet</div>");
    expect(out).not.toContain("data-steps");
  });

  test("labels stay inert text and an invalid color falls back to the default", () => {
    const out = compileDocumentBodyToHandlebars(steps, variables, { stepsColor: "red;x:y" });
    expect(out).toContain("Behoben &#123;&#123;x&#125;&#125;");
    expect(out).toContain("#1f5468{{else}}");
    expect(out).not.toContain("red;x");
  });

  test("a block with an invalid variable or duplicate keys renders nothing", () => {
    expect(compile('<div data-steps="__proto__"><span data-step="a">A</span></div><p>z</p>')).toBe(
      "<p>z</p>",
    );
    expect(
      compile(
        '<div data-steps="stage"><span data-step="a">A</span><span data-step="a">B</span></div>',
      ),
    ).toBe("");
    expect(compile('<div data-steps="stage"><span data-step="a&quot;b">A</span></div>')).toBe("");
  });

  test("headings get their size inline for mail only", () => {
    expect(compile("<h1>T</h1>")).toBe("<h1>T</h1>");
    expect(
      compileDocumentBodyToHandlebars("<h1>T</h1>", variables, { headingAsInlineStyle: true }),
    ).toContain('<h1 style="margin:0 0 12px 0;font-size:30px');
  });
});

describe("compileDocumentBodyToHandlebars :: data-if", () => {
  test("a condition on a list row wraps the whole list and reads the root variable", () => {
    const out = compile(
      '<table><tbody><tr data-each="lines" data-if="name"><td><p>x</p></td></tr></tbody></table>',
    );
    expect(out).toContain("{{#if name includeZero=true}}{{#each lines}}<tr>");
    expect(out).toContain("</tr>{{/each}}{{/if}}");
    expect(out).not.toContain("data-if");
  });

  test("a condition with an invalid name drops the block", () => {
    expect(compile('<p data-if="a b">hidden</p><p>shown</p>')).toBe("<p>shown</p>");
  });
});

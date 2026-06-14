import { describe, expect, test } from "bun:test";
import { sanitizeTenantCss } from "../css-sanitize";

const SCOPE = "[data-tenant-content]";
const css = (input: string): string => sanitizeTenantCss(input, SCOPE);

// Bypass-first: the literal-string attacks (@import, url(javascript:)) are easy
// to pass; the parser-differential ones (CSS escapes, comma scope-escape,
// case/whitespace variants) are where a naive blocklist breaks. Lead with those.
describe("sanitizeTenantCss — bypass vectors", () => {
  test("CSS hex escape \\75rl( can't re-form url() — backslash drops the decl", () => {
    // \75 = 'u'. A literal-`url(` blocklist sees an unknown ident; the browser
    // decodes it to url(. We reject any backslash outright instead.
    const out = css(".x { background-color: \\75rl(javascript:alert(1)); }");
    expect(out).toBe("");
    expect(out).not.toContain("\\");
  });

  test("escaped @import (@imp\\6frt) is dropped, not executed", () => {
    expect(css("@imp\\6frt url(evil);")).toBe("");
  });

  test("a lone backslash anywhere drops the whole rule", () => {
    expect(css(".x { color: red\\9; }")).toBe("");
    expect(css(".x\\3a hover { color: red; }")).toBe("");
  });

  test("backslash in one rule doesn't poison the others", () => {
    const out = css(".ok { color: red; } .bad { width: \\31 0px; }");
    expect(out).toContain("[data-tenant-content] .ok");
    expect(out).toContain("color: red");
    expect(out).not.toContain(".bad");
    expect(out).not.toContain("\\");
  });

  test("comma selector list is scoped per-segment (no scope-escape)", () => {
    const out = css(".a, .b { color: red; }");
    expect(out).toContain("[data-tenant-content] .a");
    expect(out).toContain("[data-tenant-content] .b");
    // the second segment must NOT survive unscoped
    expect(out).not.toMatch(/(^|,)\s*\.b\s*\{/);
  });

  test("commas inside :is()/:not() don't break top-level splitting", () => {
    // comma inside the pseudo keeps it one segment; that segment is then
    // rejected (comma not allowed in a single selector) — dropped, not split.
    expect(css(":is(.a, .b) { color: red; }")).toBe("");
  });

  test("case/whitespace url variants are all caught", () => {
    expect(css(".x { background-color: URL(x); }")).toBe("");
    expect(css(".x { background-color: url (x); }")).toBe("");
    expect(css(".x { background-color: Url( x ); }")).toBe("");
  });

  test("</style> breakout in trailing text or value never reaches output", () => {
    const trailing = css(".x { color: red; } </style><script>alert(1)</script>");
    expect(trailing).not.toContain("</style");
    expect(trailing).not.toContain("<script");
    expect(trailing).not.toContain("<");
    const inValue = css(".x { color: red</style>; }");
    expect(inValue).not.toContain("<");
  });

  test("comment-split tokens can't smuggle url(", () => {
    expect(css(".x { background-color: u/**/rl(x); }")).toBe("");
    expect(css(".x { background-color: ur/**/l(evil); }")).toBe("");
  });
});

describe("sanitizeTenantCss — named attack classes", () => {
  test("@import is dropped", () => {
    expect(css("@import url('http://evil.test');")).toBe("");
    expect(css("@import 'x';")).toBe("");
  });

  test("url(javascript:) / url(data:) are dropped, sibling decls survive", () => {
    const out = css(".x { color: red; background-color: url(javascript:alert(1)); }");
    expect(out).toContain("color: red");
    expect(out).not.toContain("url");
    expect(out).not.toContain("javascript");
  });

  test("expression() is dropped", () => {
    expect(css(".x { width: expression(alert(1)); }")).toBe("");
  });

  test("var()/custom-props are dropped in v1", () => {
    expect(css(".x { color: var(--accent); }")).toBe("");
  });

  test("position:fixed / sticky are denied (clickjacking)", () => {
    expect(css(".x { position: fixed; top: 0; left: 0; }")).toBe("");
    expect(css(".x { position: sticky; }")).toBe("");
  });

  test("position:absolute / relative are allowed (boxed by scope)", () => {
    expect(css(".x { position: absolute; }")).toContain("position: absolute");
    expect(css(".x { position: relative; }")).toContain("position: relative");
  });

  test("@media (and any at-rule with a nested block) is dropped whole", () => {
    expect(css("@media screen { .x { color: red; } }")).toBe("");
    expect(css("@font-face { font-family: evil; src: url(x); }")).toBe("");
  });

  test("content + pseudo-elements are dropped (text injection / defacement)", () => {
    expect(css(".x::before { content: 'hacked'; }")).toBe("");
    expect(css(".x { content: 'hi'; }")).toBe("");
  });

  test("attribute selectors are dropped (exfil-style selectors)", () => {
    expect(css('.x[href^="http"] { color: red; }')).toBe("");
  });

  test("-moz-binding / behavior (non-allowlisted props) are dropped", () => {
    expect(css(".x { -moz-binding: url(evil); }")).toBe("");
    expect(css(".x { behavior: url(evil.htc); }")).toBe("");
  });
});

describe("sanitizeTenantCss — structural robustness", () => {
  test("unbalanced braces fail closed (drop the rest)", () => {
    expect(css(".x { color: red;")).toBe("");
    expect(css(".ok { color: red; } .bad { color: blue;")).toContain(".ok");
    expect(css(".ok { color: red; } .bad { color: blue;")).not.toContain(".bad");
  });

  test("a rule with zero valid declarations is dropped", () => {
    expect(css(".x { unknownprop: 1; }")).toBe("");
  });
});

describe("sanitizeTenantCss — valid CSS passes, scoped", () => {
  test("a plain rule is scoped and preserved", () => {
    const out = css(".note { color: red; font-size: 1.2rem; }");
    expect(out).toBe("[data-tenant-content] .note { color: red; font-size: 1.2rem }");
  });

  test("allowed functions (rgb/rgba/hsl/calc) pass", () => {
    expect(css(".x { color: rgba(0,0,0,.5); }")).toContain("rgba(0,0,0,.5)");
    expect(css(".x { width: calc(100% - 10px); }")).toContain("calc(100% - 10px)");
  });

  test("!important is preserved", () => {
    expect(css(".x { color: red !important; }")).toContain("color: red !important");
  });

  test("multiple rules are each scoped", () => {
    const out = css("h1 { margin: 1rem; } .box { padding: 8px; }");
    expect(out).toContain("[data-tenant-content] h1");
    expect(out).toContain("[data-tenant-content] .box");
  });

  test("universal + html/body are rendered inert via scoping, not bare", () => {
    expect(css("* { color: red; }")).toBe("[data-tenant-content] * { color: red }");
    // body is scoped (inert: no <body> inside the container), never emitted bare
    const body = css("body { color: red; }");
    expect(body).toBe("[data-tenant-content] body { color: red }");
    expect(body).not.toMatch(/^body/);
  });

  test("leading comment is stripped, following rule survives", () => {
    expect(css("/* theme */ .x { color: red; }")).toContain("color: red");
  });

  test("over-length input is dropped wholesale", () => {
    const huge = `.x { color: red; }${" ".repeat(9000)}`;
    expect(css(huge)).toBe("");
  });
});

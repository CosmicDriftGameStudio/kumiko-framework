// Unit tests for guard-html-escape: parse synthetic sources in-memory and
// run guard.run directly over the SourceFiles.

import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-html-escape";

function violations(source: string): string[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  const sf = project.createSourceFile("/repo/src/test.ts", source);
  return guard.run([sf]).violations.map((v) => v.message);
}

describe("flags unescaped data in HTML templates", () => {
  test("parameter interpolation", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
    expect(violations("function render(name: string) { return `<p>${name}</p>`; }")).toHaveLength(
      1,
    );
  });

  test("property access on parameter", () => {
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
      violations("function render(user: { name: string }) { return `<div>${user.name}</div>`; }"),
    ).toHaveLength(1);
  });

  test("imported value", () => {
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
      violations('import { banner } from "./banner";\nexport const page = `<div>${banner}</div>`;'),
    ).toHaveLength(1);
  });

  test("local variable initialized from parameter", () => {
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
      violations("function render(q: string) { const t = q; return `<p>${t}</p>`; }"),
    ).toHaveLength(1);
  });

  test("imported function call", () => {
    expect(
      violations(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
        'import { renderHeader } from "./shared";\nexport function page(lang: string) { return `<body>${renderHeader(lang)}</body>`; }',
      ),
    ).toHaveLength(1);
  });
});

describe("intermediate templates and local calls are not trusted blindly", () => {
  test("tag-less intermediate template with unescaped data", () => {
    expect(
      violations(
        `function row(u: { name: string; email: string }) {
						const label = \`\${u.name} — \${u.email}\`;
						return \`<td>\${label}</td>\`;
					}`,
      ),
    ).toHaveLength(1);
  });

  test("tag-less intermediate template with escaped data is safe", () => {
    expect(
      violations(
        `declare function escapeHtml(s: string): string;
					function row(u: { name: string }) {
						const label = \`\${escapeHtml(u.name)} (user)\`;
						return \`<td>\${label}</td>\`;
					}`,
      ),
    ).toHaveLength(0);
  });

  test("unknown tagged template is not safe", () => {
    expect(
      violations(
        `declare function sql(s: TemplateStringsArray, ...v: unknown[]): string;
					function row(x: string) { const q = sql\`\${x}\`; return \`<td>\${q}</td>\`; }`,
      ),
    ).toHaveLength(1);
  });

  test("method call on a locally declared object root", () => {
    expect(
      violations(
        `const Templates = { render: (s: string) => s };
					function page(userInput: string) { return \`<div>\${Templates.render(userInput)}</div>\`; }`,
      ),
    ).toHaveLength(1);
  });

  test("local function that returns its input raw", () => {
    expect(
      violations(
        `function passthrough(s: string) { return s; }
					function page(userInput: string) { return \`<div>\${passthrough(userInput)}</div>\`; }`,
      ),
    ).toHaveLength(1);
  });

  test("string concatenation of safe operands returned by a local helper is safe, with unsafe operand is not", () => {
    expect(
      violations(
        `declare function escapeHtml(s: string): string;
					function attrs(id: string | undefined) {
						const cls = ' class="x"';
						const idAttr = id !== undefined ? \` id="\${escapeHtml(id)}"\` : "";
						return cls + idAttr;
					}
					function page(id?: string) { return \`<div\${attrs(id)}>x</div>\`; }`,
      ),
    ).toHaveLength(0);
    expect(
      violations(
        `function attrs(id: string) { return ' class="x"' + id; }
					function page(id: string) { return \`<div\${attrs(id)}>x</div>\`; }`,
      ),
    ).toHaveLength(1);
  });

  test("local arrow helper returning escaped markup is safe", () => {
    expect(
      violations(
        `declare function escapeHtml(s: string): string;
					const cell = (s: string) => \`<td>\${escapeHtml(s)}</td>\`;
					function page(v: string) { return \`<tr>\${cell(v)}</tr>\`; }`,
      ),
    ).toHaveLength(0);
  });
});

describe("accepts the escaping conventions", () => {
  test("escapeHtml / escapeHtmlAttr / escapeXml calls", () => {
    expect(
      violations(
        `import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
					function render(name: string, href: string) {
						return \`<a href="\${escapeHtmlAttr(href)}">\${escapeHtml(name)}</a>\`;
					}`,
      ),
    ).toHaveLength(0);
  });

  test("*Html naming convention (prerendered fragments)", () => {
    expect(
      violations(
        `function wrap(bodyHtml: string, s: { metaHtml: string }) {
						return \`<main>\${bodyHtml}\${s.metaHtml}</main>\`;
					}`,
      ),
    ).toHaveLength(0);
  });

  test("UPPER_SNAKE constants", () => {
    expect(
      violations(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
        'import { SHARED_CSS } from "./css";\nexport const page = `<style>${SHARED_CSS}</style>`;',
      ),
    ).toHaveLength(0);
  });

  test("local variable with template-literal initializer", () => {
    expect(
      violations(
        `function render(x: string) {
						const meta = \`<p>\${escapeHtml(x)}</p>\`;
						return \`<div>\${meta}</div>\`;
					}
					declare function escapeHtml(s: string): string;`,
      ),
    ).toHaveLength(0);
  });

  test("locally declared render helper", () => {
    expect(
      violations(
        `function icon(): string { return \`<svg><path d="M0 0" /></svg>\`; }
					export const page = \`<div>\${icon()}</div>\`;`,
      ),
    ).toHaveLength(0);
  });

  test("number-typed and literal-union-typed values", () => {
    expect(
      violations(
        `function render(width: number, variant: "a" | "b") {
						return \`<img width="\${width}" class="btn-\${variant}" src="/x.png" />\`;
					}`,
      ),
    ).toHaveLength(0);
  });

  test("arithmetic on numbers", () => {
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
      violations('function render(w: number) { return `<rect x="${w / 2}" width="20" />`; }'),
    ).toHaveLength(0);
  });

  test("string-literal types from as-const copy tables", () => {
    expect(
      violations(
        `const STRINGS = { de: { heading: "Hallo <code>x</code>" }, en: { heading: "Hello" } } as const;
					function render(lang: "de" | "en") {
						const s = STRINGS[lang];
						return \`<h1>\${s.heading}</h1>\`;
					}`,
      ),
    ).toHaveLength(0);
  });

  test(".join() of fragment arrays", () => {
    expect(
      violations(
        `function render(items: string[]) {
						const lis = items.map((i) => \`<li>\${escapeHtml(i)}</li>\`).join("");
						return \`<ul>\${lis}</ul>\`;
					}
					declare function escapeHtml(s: string): string;`,
      ),
    ).toHaveLength(0);
  });

  test(".join() of a raw string[] parameter is NOT safe (regression: join was unconditionally trusted)", () => {
    expect(
      violations(
        `function render(parts: string[]) {
						return \`<ul>\${parts.join("")}</ul>\`;
					}`,
      ),
    ).toHaveLength(1);
  });

  test("ternary and nullish branches must all be safe", () => {
    expect(
      violations(
        `function render(x: string | undefined) {
						return \`<div>\${x !== undefined ? \`<p>\${escapeHtml(x)}</p>\` : ""}</div>\`;
					}
					declare function escapeHtml(s: string): string;`,
      ),
    ).toHaveLength(0);
    expect(
      violations(
        `function render(x: string | undefined) {
						return \`<div>\${x ?? ""}</div>\`;
					}`,
      ),
    ).toHaveLength(1);
  });
});

describe("exemptions", () => {
  test("html`...` tagged template", () => {
    expect(
      violations(
        `import { html } from "@cosmicdrift/kumiko-headless";
					function render(name: string) { return html\`<p>\${name}</p>\`; }`,
      ),
    ).toHaveLength(0);
  });

  test("error messages containing tag snippets", () => {
    expect(
      violations(
        `function fail(rootId: string) {
						throw new Error(\`element <div id="\${rootId}"></div> not found\`);
					}`,
      ),
    ).toHaveLength(0);
  });

  test("html-ok suppression comment on the line before", () => {
    expect(
      violations(
        `function render(snippet: string) {
						// html-ok: Error-Hilfetext, wird nie gerendert
						return \`missing tag <script src="\${snippet}"></script>\`;
					}`,
      ),
    ).toHaveLength(0);
  });

  test("templates without HTML tags are ignored", () => {
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
      violations("function greet(name: string) { return `hello ${name}, x < 5 && y > 2`; }"),
    ).toHaveLength(0);
  });

  test("<repo>-style placeholders are not HTML", () => {
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
      violations("function usage(cmd: string) { return `usage: ${cmd} <repo> <pr>`; }"),
    ).toHaveLength(0);
  });
});

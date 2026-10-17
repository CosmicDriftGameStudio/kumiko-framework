import { describe, expect, test } from "bun:test";
import {
  mailButton,
  mailHeading,
  mailParagraph,
  mailParagraphWithLink,
  mailRepeatedRows,
  mailSubject,
} from "@cosmicdrift/kumiko-bundled-features/shared/mail-template-body";
import { templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import { compileDocumentBodyToHandlebars } from "../../template-resolver/compile-document-body.js";

const variables = {
  name: templateVariable.text(),
  actionUrl: templateVariable.link(),
  rows: templateVariable.list({ text: templateVariable.text() }),
};

describe("mail template body helpers", () => {
  test("slots become variables and author markup stays escaped", () => {
    const out = compileDocumentBodyToHandlebars(
      mailHeading("Hi {name}") + mailParagraph("Use <b>this</b>, {name}."),
      variables,
    );
    expect(out).toContain("<h2>Hi {{name}}</h2>");
    expect(out).toContain("Use &lt;b&gt;this&lt;/b&gt;, {{name}}.");
  });

  test("a button and a trailing link point at their link variable", () => {
    const out = compileDocumentBodyToHandlebars(
      mailButton("Open", "actionUrl") + mailParagraphWithLink("Not you?", "Stop", "actionUrl"),
      variables,
    );
    expect(out.match(/\{\{link actionUrl\}\}/g)).toHaveLength(2);
    expect(out).toContain(">Open</a>");
    expect(out).toContain(">Stop</a>");
  });

  test("repeated rows loop over the list and show the entry field", () => {
    const out = compileDocumentBodyToHandlebars(mailRepeatedRows("rows", "text"), variables);
    expect(out).toContain("{{#each rows}}");
    expect(out).toContain("{{text}}");
    expect(out).toContain("{{/each}}");
  });

  test("subject slots become Handlebars expressions", () => {
    expect(mailSubject("Hello {name}, {count} new")).toBe("Hello {{name}}, {{count}} new");
  });
});

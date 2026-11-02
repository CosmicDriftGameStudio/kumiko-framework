import { describe, expect, test } from "bun:test";
import { fillDocumentVariables } from "../fill-document-variables.ts";

describe("fillDocumentVariables", () => {
  test("a variable chip becomes its example value", () => {
    const html = fillDocumentVariables(
      '<p>Hi <span data-variable="customerName"></span>, order <strong><span data-variable="orderId"></span></strong>.</p>',
      { customerName: "Max Mustermann", orderId: "A-1042" },
    );
    expect(html).toBe("<p>Hi Max Mustermann, order <strong>A-1042</strong>.</p>");
  });

  test("a placeholder without an example value stays visible by its name", () => {
    expect(fillDocumentVariables('<p><span data-variable="agentName"></span></p>', {})).toBe(
      "<p>{{agentName}}</p>",
    );
  });

  test("a literal {{name}} in the text is filled like a chip", () => {
    expect(fillDocumentVariables("<p>Hi {{customerName}}</p>", { customerName: "Max" })).toBe(
      "<p>Hi Max</p>",
    );
  });

  test("markup in an example value is escaped, never parsed", () => {
    const html = fillDocumentVariables('<p><span data-variable="price"></span></p>', {
      price: '<img src=x onerror="alert(1)"><b>0</b>',
    });
    expect(html).toBe('<p>&lt;img src=x onerror="alert(1)"&gt;&lt;b&gt;0&lt;/b&gt;</p>');
    expect(html).not.toContain("<img");
  });
});

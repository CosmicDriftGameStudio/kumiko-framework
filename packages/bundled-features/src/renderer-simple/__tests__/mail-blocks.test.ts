import { describe, expect, test } from "bun:test";
import { simpleRenderer } from "../simple-renderer.js";

const render = (variables: Record<string, unknown>): Promise<string> =>
  simpleRenderer.render({ template: "t", variables });
const renderText = (variables: Record<string, unknown>): Promise<string> => {
  if (!simpleRenderer.renderText) throw new Error("renderText missing");
  return simpleRenderer.renderText({ template: "t", variables });
};

describe("simple renderer mail blocks", () => {
  test("badge renders as an escaped pill with tone colors above the header", async () => {
    const html = await render({ badge: { label: "Q&A <new>", tone: "success" }, header: "Hello" });
    expect(html).toContain("Q&amp;A &lt;new&gt;");
    expect(html).toContain("background:#dcfce7;color:#166534");
    expect(html.indexOf("Q&amp;A")).toBeLessThan(html.indexOf("<h1"));
  });

  test("unknown or missing tone falls back to neutral", async () => {
    const html = await render({
      badge: { label: "A", tone: "rainbow" },
      sections: [{ chips: [{ label: "B" }, { label: "C", tone: "constructor" }] }],
    });
    expect(html.match(/background:#f3f4f6;color:#374151/g)).toHaveLength(3);
  });

  test("chips render inline pills with their tone", async () => {
    const html = await render({
      sections: [
        {
          chips: [
            { label: "Paid", tone: "success" },
            { label: "Late <b>", tone: "danger" },
          ],
        },
      ],
    });
    expect(html).toContain("background:#dcfce7;color:#166534");
    expect(html).toContain("background:#fee2e2;color:#991b1b");
    expect(html).toContain("Late &lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  test("stages render a table track with escaped labels and no CSS classes", async () => {
    const html = await render({
      sections: [
        {
          stages: [
            { label: "Ordered", state: "done" },
            { label: "Packed <x>", state: "current" },
            { label: "Shipped", state: "upcoming" },
          ],
        },
      ],
    });
    expect(html).toContain("<table");
    expect(html).toContain("Packed &lt;x&gt;");
    expect(html).toContain("&#10003;");
    expect(html).not.toContain("class=");
    expect(html).toContain("border:2px solid #2563eb");
  });

  test("malformed stage and chip entries are skipped instead of thrown", async () => {
    const variables = {
      badge: { label: 7 },
      sections: [
        {
          stages: [
            null,
            "x",
            { label: "NoState" },
            { label: "BadState", state: "later" },
            { label: "Ok", state: "done" },
          ],
        },
        { chips: [{ tone: "info" }, 3, { label: "Fine" }] },
        { stages: "not-a-list" },
        { chips: [] },
      ],
    };
    const html = await render(variables);
    expect(html).toContain("Ok");
    expect(html).toContain("Fine");
    expect(html).not.toContain("NoState");
    expect(html).not.toContain("BadState");
    expect(await renderText(variables)).toBe("✓ Ok\n\nFine");
  });

  test("renderText prints badge, stages and chips", async () => {
    const text = await renderText({
      badge: { label: "Shipped", tone: "info" },
      header: "Order 7",
      sections: [
        {
          stages: [
            { label: "A", state: "done" },
            { label: "B", state: "current" },
            { label: "C", state: "upcoming" },
          ],
        },
        { chips: [{ label: "x" }, { label: "y", tone: "danger" }] },
      ],
    });
    expect(text).toBe("[Shipped]\n\nOrder 7\n\n✓ A → ▶ B → ○ C\n\nx · y");
  });
});

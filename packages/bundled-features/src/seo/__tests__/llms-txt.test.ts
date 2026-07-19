import { describe, expect, test } from "bun:test";
import { buildLlmsTxt } from "../llms-txt";

describe("buildLlmsTxt", () => {
  test("emits H1 title + blockquote summary", () => {
    const text = buildLlmsTxt({ title: "Acme", summary: "Acme does things." });
    expect(text).toStartWith("# Acme\n\n> Acme does things.");
  });

  test("emits ## sections with markdown links", () => {
    const text = buildLlmsTxt({
      title: "Acme",
      summary: "s",
      sections: [
        {
          heading: "Pages",
          links: [{ title: "About", url: "https://acme.test/about", desc: "About us" }],
        },
      ],
    });
    expect(text).toContain("## Pages");
    expect(text).toContain("- [About](https://acme.test/about): About us");
  });

  test("empty sections are omitted, no trailing section markers", () => {
    const text = buildLlmsTxt({
      title: "Acme",
      summary: "s",
      sections: [{ heading: "Empty", links: [] }],
    });
    expect(text).not.toContain("## Empty");
  });

  test("no summary → no blockquote line", () => {
    const text = buildLlmsTxt({ title: "Acme", summary: "" });
    expect(text).toBe("# Acme\n");
  });
});

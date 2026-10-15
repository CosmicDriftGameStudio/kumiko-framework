import { describe, expect, test } from "bun:test";
import { diffTemplateBlocks, splitTemplateBlocks } from "../template-diff";

describe("splitTemplateBlocks", () => {
  test("html splits into top-level elements and keeps bare text", () => {
    expect(splitTemplateBlocks("<p>One</p><ul><li>a</li></ul>\n loose <p>Two</p>", "html")).toEqual(
      ["<p>One</p>", "<ul><li>a</li></ul>", "loose", "<p>Two</p>"],
    );
  });

  test("non-html splits at blank lines, trimmed, without empty blocks", () => {
    expect(splitTemplateBlocks("  Hello\nworld \n\n\n\nBye\r\n\r\n  \n", "markdown")).toEqual([
      "Hello\nworld",
      "Bye",
    ]);
  });
});

describe("diffTemplateBlocks", () => {
  test("identical lists are all same", () => {
    expect(diffTemplateBlocks(["a", "b"], ["a", "b"])).toEqual([
      { change: "same", content: "a" },
      { change: "same", content: "b" },
    ]);
  });

  test("a changed block is one removed plus one added between the unchanged ones", () => {
    expect(diffTemplateBlocks(["a", "b", "c"], ["a", "B", "c"])).toEqual([
      { change: "same", content: "a" },
      { change: "removed", content: "b" },
      { change: "added", content: "B" },
      { change: "same", content: "c" },
    ]);
  });

  test("blocks only on one side are removed or added", () => {
    expect(diffTemplateBlocks(["a", "b"], ["b", "c"])).toEqual([
      { change: "removed", content: "a" },
      { change: "same", content: "b" },
      { change: "added", content: "c" },
    ]);
    expect(diffTemplateBlocks([], ["x"])).toEqual([{ change: "added", content: "x" }]);
    expect(diffTemplateBlocks(["x"], [])).toEqual([{ change: "removed", content: "x" }]);
  });

  test("oversized inputs skip the LCS and report everything as replaced", () => {
    const system = Array.from({ length: 1001 }, (_, index) => `s${index}`);
    const tenant = Array.from({ length: 1000 }, (_, index) => `s${index}`);
    const result = diffTemplateBlocks(system, tenant);
    expect(result).toHaveLength(2001);
    expect(result.every((block) => block.change !== "same")).toBe(true);
  });
});

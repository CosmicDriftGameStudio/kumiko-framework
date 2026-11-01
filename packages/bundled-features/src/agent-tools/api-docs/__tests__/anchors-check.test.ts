import { describe, expect, test } from "bun:test";
import { anchorsForPage, handlerHeading, slugify } from "../anchors.ts";
import { diffApiDocsOutput } from "../check.ts";

describe("anchors", () => {
  test("heading drops the feature and the query/write kind", () => {
    expect(handlerHeading("helpdesk:write:ticket:close")).toBe("ticket: close");
    expect(slugify("ticket: close")).toBe("ticket-close");
  });

  test("two handlers with the same tail both switch to the full QN form", () => {
    const anchors = anchorsForPage([
      "helpdesk:write:ticket:close",
      "support:write:ticket:close",
      "helpdesk:write:ticket:open",
    ]);
    expect(anchors.map((a) => a.heading)).toEqual([
      "helpdesk: write: ticket: close",
      "support: write: ticket: close",
      "ticket: open",
    ]);
    expect(new Set(anchors.map((a) => a.anchor)).size).toBe(3);
  });
});

describe("diffApiDocsOutput", () => {
  test("reports missing, changed and extra files", () => {
    const expected = new Map([
      ["a.md", "1"],
      ["b.md", "2"],
      ["c.md", "3"],
    ]);
    const actual = new Map([
      ["b.md", "changed"],
      ["c.md", "3"],
      ["z.md", "x"],
    ]);
    expect(diffApiDocsOutput(expected, actual)).toEqual({
      missing: ["a.md"],
      changed: ["b.md"],
      extra: ["z.md"],
    });
  });
});

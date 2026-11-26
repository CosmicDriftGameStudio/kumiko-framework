import { describe, expect, test } from "bun:test";
import { replaceTagsWithSpace } from "../placeholder-text.ts";

describe("replaceTagsWithSpace", () => {
  test("replaces each tag with one space", () => {
    expect(replaceTagsWithSpace("<p>a</p><br>b")).toBe(" a  b");
  });

  test("keeps an unclosed tag and a lone bracket as text", () => {
    expect(replaceTagsWithSpace("a < b")).toBe("a < b");
    expect(replaceTagsWithSpace("<b>x</b> <i")).toBe(" x  <i");
    expect(replaceTagsWithSpace("a > b")).toBe("a > b");
  });
});

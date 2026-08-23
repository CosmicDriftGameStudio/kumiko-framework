import { describe, expect, test } from "bun:test";
import { toAcceptAttr } from "../accept-attr";

describe("toAcceptAttr", () => {
  test("bare extensions get a leading dot", () => {
    expect(toAcceptAttr(["pdf"])).toBe(".pdf");
  });

  test("extensions with a dot pass through", () => {
    expect(toAcceptAttr([".pdf"])).toBe(".pdf");
  });

  test("mime types pass through", () => {
    expect(toAcceptAttr(["image/png"])).toBe("image/png");
  });

  test("mixed entries are comma-joined", () => {
    expect(toAcceptAttr(["pdf", ".docx", "image/*"])).toBe(".pdf,.docx,image/*");
  });

  test("empty list yields undefined", () => {
    expect(toAcceptAttr([])).toBeUndefined();
  });

  test("missing list yields undefined", () => {
    expect(toAcceptAttr(undefined)).toBeUndefined();
  });
});

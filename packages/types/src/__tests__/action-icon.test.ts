import { describe, expect, test } from "bun:test";
import { resolveActionIcon } from "../action-icon.js";

describe("resolveActionIcon", () => {
  test("an author-declared icon wins over every id-derived default", () => {
    expect(resolveActionIcon("delete", "pencil")).toBe("pencil");
    expect(resolveActionIcon("no-known-verb", "eye")).toBe("eye");
  });

  test("an id without a hyphen resolves by itself, or to undefined when unknown", () => {
    expect(resolveActionIcon("delete")).toBe("trash");
    expect(resolveActionIcon("archive")).toBe("archive");
    expect(resolveActionIcon("pause")).toBeUndefined();
    expect(resolveActionIcon("")).toBeUndefined();
  });

  test("the last kebab segment resolves a verb-suffixed id", () => {
    expect(resolveActionIcon("order-ship-send")).toBe("send");
    expect(resolveActionIcon("invoice-download")).toBe("download");
  });

  test("the last segment beats the first one when both are known verbs", () => {
    expect(resolveActionIcon("cancel-deletion")).toBe("trash");
    expect(resolveActionIcon("add-item-delete")).toBe("trash");
  });

  test("the first segment is the last resort when the last one is unknown", () => {
    expect(resolveActionIcon("add-item")).toBe("plus");
    expect(resolveActionIcon("open-terminate-form")).toBe("eye");
  });

  test("an id with no known segment resolves to undefined", () => {
    expect(resolveActionIcon("pause-job-now")).toBeUndefined();
  });
});

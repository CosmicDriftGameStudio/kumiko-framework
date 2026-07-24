import { describe, expect, test } from "bun:test";
import { buildStorageKey } from "../types";

describe("buildStorageKey", () => {
  test("uses the lowercased extension for a normal filename", () => {
    const key = buildStorageKey("T1" as never, "invoice", 1, "attachment", "logo.PNG", "u1");
    expect(key).toBe("T1/invoice/1/attachment/u1.png");
  });

  test("uses the sole segment as extension when there is no dot", () => {
    const key = buildStorageKey("T1" as never, "invoice", 1, "attachment", "noext", "u1");
    expect(key).toBe("T1/invoice/1/attachment/u1.noext");
  });

  test("rejects a path-traversal filename and falls back to bin instead of leaking the payload", () => {
    const key = buildStorageKey(
      "T1" as never,
      "unattached",
      "file",
      "u",
      "a.b/../../../../evil",
      "u1",
    );
    expect(key).toBe("T1/unattached/file/u/u1.bin");
    expect(key).not.toContain("..");
    expect(key.split("/")).toHaveLength(5);
  });
});

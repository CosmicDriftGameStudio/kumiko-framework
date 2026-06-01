import { describe, expect, spyOn, test } from "bun:test";
import { parseComplianceProfileOverride } from "../_internal/parse-override";

describe("parseComplianceProfileOverride", () => {
  test("empty / whitespace / null → undefined, no warning", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseComplianceProfileOverride(null, "t1", "seed")).toBeUndefined();
      expect(parseComplianceProfileOverride("", "t1", "seed")).toBeUndefined();
      expect(parseComplianceProfileOverride("   ", "t1", "seed")).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("valid JSON object is returned verbatim", () => {
    expect(parseComplianceProfileOverride('{"region":"eu"}', "t1", "seed")).toEqual({
      region: "eu",
    });
  });

  test("literal JSON null → undefined (no override), no warning", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseComplianceProfileOverride("null", "t1", "seed")).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("corrupt JSON warns WITH the parser reason and returns undefined (not a silent swallow)", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = parseComplianceProfileOverride(
        "{not valid json",
        "tenant-9",
        "resolve-for-tenant",
      );
      expect(result).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]?.[0]);
      expect(msg).toContain("tenant-9");
      expect(msg).toContain("resolve-for-tenant");
      // The point of the fix: the parser's own failure reason is preserved,
      // not flattened to a generic "is not valid JSON".
      expect(msg).toContain("Reason:");
    } finally {
      warn.mockRestore();
    }
  });
});

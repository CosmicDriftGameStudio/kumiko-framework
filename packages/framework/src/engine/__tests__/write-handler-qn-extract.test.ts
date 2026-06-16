import { describe, expect, test } from "bun:test";
import {
  extractDispatcherWriteQnsFromSource,
  validateDispatcherWriteQn,
  WRITE_HANDLER_QN_FORMAT_RE,
} from "../write-handler-qn-extract";

describe("extractDispatcherWriteQnsFromSource", () => {
  test("extracts string literals from dispatcher.write and .write calls", () => {
    const source = `
      await dispatcher.write("credit:write:create", { name: "x" });
      await foo.write("tenant:write:update", payload);
    `;
    expect(extractDispatcherWriteQnsFromSource(source)).toEqual([
      "credit:write:create",
      "tenant:write:update",
    ]);
  });

  test("skips dynamic QNs", () => {
    const source = `await dispatcher.write(HANDLERS.delete, { id });`;
    expect(extractDispatcherWriteQnsFromSource(source)).toEqual([]);
  });
});

describe("validateDispatcherWriteQn", () => {
  const known = new Set(["credit:write:credit:delete", "tenant:write:create"]);

  test("accepts known QN", () => {
    expect(validateDispatcherWriteQn("credit:write:credit:delete", known)).toEqual({ ok: true });
  });

  test("rejects invalid format", () => {
    const result = validateDispatcherWriteQn("feautre-write-create", known);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("invalid QN format");
  });

  test("rejects unknown QN when registry provided", () => {
    const result = validateDispatcherWriteQn("credit:write:update", known);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("unknown write handler");
  });

  test("format regex accepts 4-segment entity delete QNs", () => {
    expect(WRITE_HANDLER_QN_FORMAT_RE.test("credit:write:credit:delete")).toBe(true);
  });
});

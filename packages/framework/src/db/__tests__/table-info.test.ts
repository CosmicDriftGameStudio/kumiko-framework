import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/index.ts";
import { buildEntityTable, declareSystemRowsReadable } from "../table-builder.ts";
import { extractTableInfo } from "../table-info.ts";

const entity = createEntity({
  name: "tableInfoProbe",
  fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
});

describe("extractTableInfo", () => {
  test("returns the same info for repeated calls on one table", () => {
    const t = buildEntityTable(entity);
    expect(extractTableInfo(t)).toBe(extractTableInfo(t));
    expect(extractTableInfo(t).columnOf("tenantId")).toBe("tenant_id");
    expect(extractTableInfo(t).fieldOf("tenant_id")).toBe("tenantId");
  });

  test("a replaced meta gets fresh info", () => {
    const t = buildEntityTable(entity);
    const before = extractTableInfo(t);
    declareSystemRowsReadable(t);
    const after = extractTableInfo(t);
    expect(after).not.toBe(before);
    expect(after.columnOf("tenantId")).toBe("tenant_id");
  });

  test("a table without meta still throws", () => {
    expect(() => extractTableInfo({})).toThrow(/not a kumiko EntityTableMeta/);
  });
});

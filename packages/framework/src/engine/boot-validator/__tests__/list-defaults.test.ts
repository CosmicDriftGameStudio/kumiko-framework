import { describe, expect, test } from "bun:test";
import { validateListDefaultsOptions } from "../list-defaults.ts";

const FULL_BLOCK = {
  table: {
    rememberState: true,
    resetAll: true,
    columnPicker: true,
    density: { default: "compact", userChoice: true },
    pinning: true,
    resizing: true,
    keyboardNavigation: true,
    export: { xlsx: true, maxRows: 500 },
  },
  pinFirstColumn: true,
};

describe("validateListDefaultsOptions", () => {
  test("accepts the full block", () => {
    expect(() => validateListDefaultsOptions(FULL_BLOCK)).not.toThrow();
  });

  test("accepts pinFirstColumn: false without pinning", () => {
    expect(() =>
      validateListDefaultsOptions({ table: { columnPicker: true }, pinFirstColumn: false }),
    ).not.toThrow();
  });

  test.each([
    ["grouping", { grouping: { field: "status" } }, /listDefaults\.table\.grouping is not allowed/],
    [
      "totals",
      { totals: [{ field: "n", kind: "sum" }] },
      /listDefaults\.table\.totals is not allowed/,
    ],
    [
      "unknown table key",
      { columnPickr: true },
      /listDefaults table has unknown key\(s\) "columnPickr"/,
    ],
    ["invalid density", { density: "compact" }, /listDefaults table\.density must be an object/],
    ["empty density", { density: {} }, /listDefaults table\.density is empty/],
    [
      "unknown density default",
      { density: { default: "huge" } },
      /listDefaults table\.density\.default is "huge"/,
    ],
    ["non-boolean pinning", { pinning: "yes" }, /listDefaults table\.pinning must be a boolean/],
    [
      "export without xlsx",
      { export: { maxRows: 10 } },
      /listDefaults table\.export\.xlsx must be true/,
    ],
    [
      "export.maxRows below 1",
      { export: { xlsx: true, maxRows: 0 } },
      /listDefaults table\.export\.maxRows is 0/,
    ],
  ])("rejects %s", (_name, table, message) => {
    expect(() => validateListDefaultsOptions({ table })).toThrow(message);
  });

  test("rejects an unknown key in the block", () => {
    expect(() => validateListDefaultsOptions({ table: {}, pinFirst: true })).toThrow(
      /listDefaults has unknown key\(s\) "pinFirst"\. Allowed keys: table, pinFirstColumn\./,
    );
  });

  test("rejects a non-object block and a non-object table", () => {
    expect(() => validateListDefaultsOptions("yes")).toThrow(/listDefaults must be an object/);
    expect(() => validateListDefaultsOptions({ table: "yes" })).toThrow(
      /listDefaults\.table must be an object/,
    );
  });

  test("rejects a non-boolean pinFirstColumn", () => {
    expect(() => validateListDefaultsOptions({ table: {}, pinFirstColumn: "yes" })).toThrow(
      /listDefaults\.pinFirstColumn must be a boolean/,
    );
  });

  test("rejects pinFirstColumn without table.pinning", () => {
    expect(() => validateListDefaultsOptions({ table: {}, pinFirstColumn: true })).toThrow(
      /listDefaults\.pinFirstColumn needs listDefaults\.table\.pinning: true/,
    );
  });
});

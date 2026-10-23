import { describe, expect, test } from "bun:test";
import { validateBundledListsOptions } from "../bundled-lists-table.ts";

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

describe("validateBundledListsOptions", () => {
  test("accepts the full block", () => {
    expect(() => validateBundledListsOptions(FULL_BLOCK)).not.toThrow();
  });

  test("accepts pinFirstColumn: false without pinning", () => {
    expect(() =>
      validateBundledListsOptions({ table: { columnPicker: true }, pinFirstColumn: false }),
    ).not.toThrow();
  });

  test.each([
    ["grouping", { grouping: { field: "status" } }, /bundledLists\.table\.grouping is not allowed/],
    [
      "totals",
      { totals: [{ field: "n", kind: "sum" }] },
      /bundledLists\.table\.totals is not allowed/,
    ],
    [
      "unknown table key",
      { columnPickr: true },
      /bundledLists table has unknown key\(s\) "columnPickr"/,
    ],
    ["invalid density", { density: "compact" }, /bundledLists table\.density must be an object/],
    ["empty density", { density: {} }, /bundledLists table\.density is empty/],
    [
      "unknown density default",
      { density: { default: "huge" } },
      /bundledLists table\.density\.default is "huge"/,
    ],
    ["non-boolean pinning", { pinning: "yes" }, /bundledLists table\.pinning must be a boolean/],
    [
      "export without xlsx",
      { export: { maxRows: 10 } },
      /bundledLists table\.export\.xlsx must be true/,
    ],
    [
      "export.maxRows below 1",
      { export: { xlsx: true, maxRows: 0 } },
      /bundledLists table\.export\.maxRows is 0/,
    ],
  ])("rejects %s", (_name, table, message) => {
    expect(() => validateBundledListsOptions({ table })).toThrow(message);
  });

  test("rejects an unknown key in the block", () => {
    expect(() => validateBundledListsOptions({ table: {}, pinFirst: true })).toThrow(
      /bundledLists has unknown key\(s\) "pinFirst"\. Allowed keys: table, pinFirstColumn\./,
    );
  });

  test("rejects a non-object block and a non-object table", () => {
    expect(() => validateBundledListsOptions("yes")).toThrow(/bundledLists must be an object/);
    expect(() => validateBundledListsOptions({ table: "yes" })).toThrow(
      /bundledLists\.table must be an object/,
    );
  });

  test("rejects a non-boolean pinFirstColumn", () => {
    expect(() => validateBundledListsOptions({ table: {}, pinFirstColumn: "yes" })).toThrow(
      /bundledLists\.pinFirstColumn must be a boolean/,
    );
  });

  test("rejects pinFirstColumn without table.pinning", () => {
    expect(() => validateBundledListsOptions({ table: {}, pinFirstColumn: true })).toThrow(
      /bundledLists\.pinFirstColumn needs bundledLists\.table\.pinning: true/,
    );
  });
});

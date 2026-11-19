import { describe, expect, test } from "bun:test";
import { toExportCell } from "../export-cells.ts";
import type { ExportColumn } from "../export-columns.ts";

const amountColumn: ExportColumn = {
  field: "amount",
  headerKey: "amount",
  headerFallback: "Amount",
  cell: { kind: "money" },
};

function moneyCellOf(amount: number, currency: string) {
  return toExportCell(amountColumn, {
    row: { amount: { amount, currency } },
    translate: (key) => key,
    timeZone: "UTC",
  });
}

describe("toExportCell money", () => {
  test("formats with the currency's decimals", () => {
    expect(moneyCellOf(1234500, "KWD")).toMatchObject({ value: 1234.5, format: '#,##0.000 "KWD"' });
    expect(moneyCellOf(1234, "JPY")).toMatchObject({ value: 1234, format: '#,##0 "JPY"' });
    expect(moneyCellOf(123450, "EUR")).toMatchObject({ value: 1234.5, format: '#,##0.00 "EUR"' });
  });
});

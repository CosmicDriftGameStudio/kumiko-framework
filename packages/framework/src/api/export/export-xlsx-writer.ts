import writeXlsxFile, { type Cell, type SheetData } from "write-excel-file/node";
import { type Translate, toExportCell } from "./export-cells.ts";
import { guardSheetAgainstCiphertext } from "./export-ciphertext-guard.ts";
import type { ExportColumn } from "./export-columns.ts";
import type { ExportRow } from "./export-rows.ts";

function headerLabel(column: ExportColumn, translate: Translate): string {
  const translated = translate(column.headerKey);
  return translated === column.headerKey ? column.headerFallback : translated;
}

export async function writeExportWorkbook(
  columns: readonly ExportColumn[],
  rows: readonly ExportRow[],
  translate: Translate,
  timeZone: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const header: Cell[] = columns.map((column) => ({
    value: headerLabel(column, translate),
    type: String,
    fontWeight: "bold",
  }));
  const body: Cell[][] = rows.map((row) =>
    columns.map((column) => toExportCell(column, { row, translate, timeZone })),
  );
  const sheetData: SheetData = guardSheetAgainstCiphertext([header, ...body]);
  const buffer = await writeXlsxFile(sheetData, {}).toBuffer();
  // Buffer is typed over ArrayBufferLike; a plain copy gives Response a BodyInit-compatible view.
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

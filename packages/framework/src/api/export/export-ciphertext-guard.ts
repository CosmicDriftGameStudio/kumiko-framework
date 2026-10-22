import type { Cell, SheetData } from "write-excel-file/node";
import { InternalError } from "../../errors/index.ts";
import { createFallbackLogger } from "../../logging/utils.ts";
import { CIPHERTEXT_RE, CIPHERTEXT_REDACT_RE, CIPHERTEXT_REDACTION } from "../pii-leak-guard.ts";

const log = createFallbackLogger("kumiko:export-xlsx");

// The response guard only scans JSON, so a workbook needs its own check: a ciphertext in a cell
// means a raw DB read reached the export. Same policy as the guard: loud outside production,
// redacted and logged in production.
function guardText(text: string, isProduction: boolean): string {
  if (!CIPHERTEXT_RE.test(text)) return text;
  const detail =
    "XLSX export contains a PII ciphertext — a raw DB read leaked into the sheet. " +
    "Decrypt before returning (decryptStoredPii / executor read path).";
  if (!isProduction) throw new InternalError({ message: detail });
  log.error(detail);
  return text.replace(CIPHERTEXT_REDACT_RE, CIPHERTEXT_REDACTION);
}

function guardCell(cell: Cell, isProduction: boolean): Cell {
  if (typeof cell !== "object" || cell === null || !("value" in cell)) return cell;
  if (typeof cell.value !== "string") return cell;
  return { ...cell, value: guardText(cell.value, isProduction) };
}

export function guardSheetAgainstCiphertext(
  sheet: SheetData,
  isProduction: boolean = process.env["NODE_ENV"] === "production",
): SheetData {
  return sheet.map((row) => row.map((cell) => guardCell(cell, isProduction)));
}

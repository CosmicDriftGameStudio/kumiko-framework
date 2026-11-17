// RFC 4180 CSV: a cell with the delimiter, a quote or a line break is quoted, and a quote inside is
// doubled. Cells are returned verbatim (no trim), so callers trim what they need.

export type CsvDelimiter = "," | ";" | "\t";

export type CsvRecord = {
  /** Physical line the record starts on; the first line is 1. */
  readonly line: number;
  readonly cells: readonly string[];
};

export type CsvParse = {
  readonly records: readonly CsvRecord[];
  /** A quote was opened and never closed: everything after it went into one cell. */
  readonly unterminatedQuote: boolean;
};

const BYTE_ORDER_MARK = "\uFEFF";

export function parseCsv(text: string, options: { readonly delimiter: CsvDelimiter }): CsvParse {
  const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = (): void => {
    cells.push(cell);
    if (cells.some((value) => value !== "")) records.push({ line: recordLine, cells });
    cells = [];
    cell = "";
  };

  for (let index = 0; index < source.length; index++) {
    const char = source.charAt(index);
    if (quoted) {
      if (char === '"' && source.charAt(index + 1) === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line++;
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === options.delimiter) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source.charAt(index + 1) === "\n") index++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      cell += char;
    }
  }
  const unterminatedQuote = quoted;
  endRecord();
  return { records, unterminatedQuote };
}

// Spreadsheets evaluate a leading =, +, -, @, tab or CR as a formula; plain numbers stay so negative amounts keep working.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d[\d.,]*$/;

function protectFormula(cell: string): string {
  return FORMULA_START.test(cell) && !PLAIN_NUMBER.test(cell) ? `'${cell}` : cell;
}

export function formatCsv(
  rows: readonly (readonly string[])[],
  options: { readonly delimiter: CsvDelimiter },
): string {
  const { delimiter } = options;
  const formatCell = (raw: string): string => {
    const cell = protectFormula(raw);
    const needsQuotes =
      cell.includes(delimiter) || cell.includes('"') || cell.includes("\r") || cell.includes("\n");
    return needsQuotes ? `"${cell.replaceAll('"', '""')}"` : cell;
  };
  return rows.map((row) => `${row.map(formatCell).join(delimiter)}\r\n`).join("");
}

import { describe, expect, test } from "bun:test";
import { formatCsv, parseCsv } from "../csv.ts";

const semi = { delimiter: ";" } as const;
const comma = { delimiter: "," } as const;

describe("parseCsv", () => {
  test("splits on the delimiter and unquotes cells", () => {
    expect(parseCsv('a;"b;c";"say ""hi"""', semi).records[0]?.cells).toEqual([
      "a",
      "b;c",
      'say "hi"',
    ]);
    expect(parseCsv('a,"b,c",d', comma).records[0]?.cells).toEqual(["a", "b,c", "d"]);
  });

  test("keeps a multi-line quoted cell as one cell and counts lines", () => {
    const { records } = parseCsv('h1;h2\n"line one\nline two";x\nnext;y', semi);
    expect(records.map((r) => r.cells)).toEqual([
      ["h1", "h2"],
      ["line one\nline two", "x"],
      ["next", "y"],
    ]);
    expect(records.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  test("strips a BOM", () => {
    expect(parseCsv("\uFEFFa;b", semi).records[0]?.cells).toEqual(["a", "b"]);
  });

  test("skips blank records and accepts CRLF and CR line ends", () => {
    const { records } = parseCsv("a;b\r\n\r\nc;d\re;f\n", semi);
    expect(records.map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  test("flags an unterminated quote", () => {
    expect(parseCsv('a;"open', semi).unterminatedQuote).toBe(true);
    expect(parseCsv('a;"closed"', semi).unterminatedQuote).toBe(false);
  });

  test("keeps surrounding whitespace", () => {
    expect(parseCsv(" a ; b ", semi).records[0]?.cells).toEqual([" a ", " b "]);
  });
});

describe("formatCsv", () => {
  test("quotes cells with delimiter, quote or line break", () => {
    expect(formatCsv([["a;b", 'q"q', "x\ny", "plain"]], semi)).toBe(
      '"a;b";"q""q";"x\ny";plain\r\n',
    );
  });

  test("protects formula starts", () => {
    expect(formatCsv([['=HYPERLINK("x")']], semi)).toBe(`"'=HYPERLINK(""x"")"\r\n`);
    expect(formatCsv([["-aaa"]], semi)).toBe("'-aaa\r\n");
    expect(formatCsv([["\tcmd"]], semi)).toBe("'\tcmd\r\n");
  });

  test("leaves plain numbers alone", () => {
    expect(formatCsv([["-12,50", "+3"]], semi)).toBe("-12,50;+3\r\n");
  });

  test("ends lines with CRLF and returns empty for no rows", () => {
    expect(formatCsv([["a"], ["b"]], semi)).toBe("a\r\nb\r\n");
    expect(formatCsv([], semi)).toBe("");
  });

  test("roundtrips cells without formula start", () => {
    const rows = [
      ["name", "note"],
      ["a;b", 'say "hi"'],
      ["multi\nline", " spaced "],
    ];
    const parsed = parseCsv(formatCsv(rows, semi), semi);
    expect(parsed.records.map((r) => r.cells)).toEqual(rows);
  });
});

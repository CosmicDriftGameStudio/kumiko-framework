import { describe, expect, test } from "vitest";
import {
  buildContentDispositionHeader,
  encodeRFC5987,
  toAsciiFallback,
} from "../content-disposition";

describe("toAsciiFallback", () => {
  test("keeps ASCII letters, digits, dot, dash, underscore, parens", () => {
    expect(toAsciiFallback("photo_2024-01.png")).toBe("photo_2024-01.png");
    expect(toAsciiFallback("report(v2).pdf")).toBe("report(v2).pdf");
  });

  test("collapses spaces, commas, and other non-safe chars to underscore", () => {
    expect(toAsciiFallback("my photo, v2.png")).toBe("my_photo__v2.png");
  });

  test("strips quote characters — the core injection protection", () => {
    const evil = `safe.png"; filename*=utf-8''evil.exe`;
    const out = toAsciiFallback(evil);
    expect(out).not.toContain('"');
    expect(out).not.toContain(";");
  });

  test("strips backslash and path separators (directory-traversal guard)", () => {
    // Dots survive (whitelisted); `/` and `\` collapse to underscore.
    expect(toAsciiFallback("../../../etc/passwd")).toBe(".._.._.._etc_passwd");
    expect(toAsciiFallback("C:\\Windows\\evil.exe")).toBe("C__Windows_evil.exe");
  });

  test("collapses non-ASCII (unicode) to underscore — one char per code unit", () => {
    // 測 + 試 = 2 BMP code units → 2 underscores, then `.png` passes through.
    expect(toAsciiFallback("測試.png")).toBe("__.png");
    expect(toAsciiFallback("café.pdf")).toBe("caf_.pdf");
  });

  test("truncates at 100 chars to bound header size", () => {
    const longName = `${"a".repeat(200)}.png`;
    const out = toAsciiFallback(longName);
    expect(out.length).toBe(100);
    expect(out.startsWith("aaaa")).toBe(true);
  });

  test("returns 'download' for empty input or when no alphanumerics survive", () => {
    // Empty stripped.
    expect(toAsciiFallback("")).toBe("download");
    // All non-safe chars collapsed → 12 underscores → readable default.
    expect(toAsciiFallback("@@@###$$$%%%")).toBe("download");
    // Mix of symbols + dots (dots whitelisted) → still no alphanumerics.
    expect(toAsciiFallback("@.#.$")).toBe("download");
  });
});

describe("encodeRFC5987", () => {
  test("passes pure ASCII through (letters, digits)", () => {
    expect(encodeRFC5987("photo.png")).toBe("photo.png");
  });

  test("percent-encodes UTF-8 bytes for non-ASCII", () => {
    // 測 = UTF-8 E6 B8 AC → %E6%B8%AC
    const out = encodeRFC5987("測");
    expect(out).toBe("%E6%B8%AC");
  });

  test("escapes the RFC-5987 extras that encodeURIComponent leaves alone", () => {
    // encodeURIComponent doesn't escape ' ( ) * — RFC 5987 requires we do.
    // Each char maps to its uppercase hex code.
    expect(encodeRFC5987("a'b")).toBe("a%27b");
    expect(encodeRFC5987("a(b)")).toBe("a%28b%29");
    expect(encodeRFC5987("a*b")).toBe("a%2Ab");
  });

  test("uses uppercase hex for consistency (matches RFC sample output)", () => {
    expect(encodeRFC5987(" ")).toBe("%20");
    expect(encodeRFC5987(";")).toBe("%3B");
  });
});

describe("buildContentDispositionHeader", () => {
  test("pure ASCII input produces both parameters", () => {
    const header = buildContentDispositionHeader("photo.png");
    expect(header).toBe(`attachment; filename="photo.png"; filename*=UTF-8''photo.png`);
  });

  test("unicode input survives losslessly in filename*, stripped in fallback", () => {
    const header = buildContentDispositionHeader("測試.png");
    // 2 BMP code units → 2 underscores in fallback, then `.png`.
    expect(header).toContain(`filename="__.png"`);
    // filename* carries the full UTF-8 bytes percent-encoded.
    expect(header).toContain("filename*=UTF-8''%E6%B8%AC%E8%A9%A6.png");
  });

  test("injection attempt — header has exactly 3 semicolon-separated parts", () => {
    // `"; filename*=utf-8''evil.exe` injection — sanitised header must
    // still parse as a single attachment with exactly two parameters.
    const header = buildContentDispositionHeader(`normal.png"; filename*=utf-8''evil.exe`);
    const parts = header.split(";");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("attachment");
    expect(parts[1]?.trim().startsWith("filename=")).toBe(true);
    expect(parts[2]?.trim().startsWith("filename*=")).toBe(true);
  });

  test("fallback never leaks unquoted double-quote", () => {
    // Any quote inside filename="..." would close the string early and
    // let the tail parse as new parameters. Proof: the fallback value
    // (the chars between the first two quotes after "filename=") has
    // no further quotes.
    const header = buildContentDispositionHeader(`a"b"c.png`);
    const match = header.match(/filename="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match?.[1]).not.toContain('"');
    // All 3 quotes collapsed to underscore in the fallback.
    expect(match?.[1]).toBe("a_b_c.png");
  });

  test("empty filename falls back to 'download'", () => {
    const header = buildContentDispositionHeader("");
    expect(header).toContain(`filename="download"`);
    // Empty filename*: encodeRFC5987("") → "", so filename*=UTF-8''
    expect(header).toContain(`filename*=UTF-8''`);
  });
});

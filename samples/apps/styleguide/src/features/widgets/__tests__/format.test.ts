import { describe, expect, it } from "bun:test";
import { euro, percent } from "../lib/format";

describe("euro", () => {
  it("puts the currency symbol first, comma thousands separators, in en locale", () => {
    expect(euro(92753, "en")).toBe("€92,753.00");
  });

  it("puts the currency symbol last, dot thousands separators, in de locale", () => {
    // Real Intl.NumberFormat output uses a non-breaking space (U+00A0) before the symbol.
    expect(euro(92753, "de-DE")).toBe("92.753,00 €");
  });
});

describe("percent", () => {
  it("uses a non-breaking space before % in de locale", () => {
    expect(percent(3.1, "de-DE")).toBe("3,1 %");
  });

  it("appends no space before % in en locale", () => {
    expect(percent(3.1, "en")).toBe("3.1%");
  });
});

describe("invalid locale tags", () => {
  it("euro falls back to en instead of throwing on a POSIX-style tag", () => {
    expect(euro(92753, "de_DE")).toBe("€92,753.00");
  });

  it("percent falls back to en instead of throwing on a POSIX-style tag", () => {
    expect(percent(3.1, "de_DE")).toBe("3.1%");
  });
});

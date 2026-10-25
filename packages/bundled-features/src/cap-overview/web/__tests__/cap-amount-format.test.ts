import { describe, expect, test } from "bun:test";
import { formatCapAmount } from "../cap-amount-format.ts";

// Intl may emit a narrow/no-break space between number and unit.
const plain = (text: string): string => text.replace(/\s/g, " ");

describe("formatCapAmount", () => {
  test("mb values scale to MB, GB and TB with base 1024", () => {
    expect(plain(formatCapAmount(0, "mb", "en"))).toBe("0 MB");
    expect(plain(formatCapAmount(512, "mb", "en"))).toBe("512 MB");
    expect(plain(formatCapAmount(102400, "mb", "de"))).toBe("100 GB");
    expect(plain(formatCapAmount(102400, "mb", "en"))).toBe("100 GB");
    expect(plain(formatCapAmount(1536, "mb", "de"))).toBe("1,5 GB");
    expect(plain(formatCapAmount(1024 * 1024 * 2, "mb", "en"))).toBe("2 TB");
  });

  test("count and tokens group digits per locale", () => {
    expect(formatCapAmount(150000, "count", "de")).toBe("150.000");
    expect(formatCapAmount(150000, "tokens", "en")).toBe("150,000");
  });

  test("missing unit formats as a plain number", () => {
    expect(formatCapAmount(150000, undefined, "de")).toBe("150.000");
  });

  test("an invalid locale tag falls back to the raw number", () => {
    expect(formatCapAmount(1500, "count", "not a locale")).toBe("1500");
  });
});

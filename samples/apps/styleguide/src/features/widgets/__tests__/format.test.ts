import { describe, expect, it } from "bun:test";
import { euro, percent } from "../lib/format";

describe("euro", () => {
  it("uses comma thousands separators in en locale", () => {
    expect(euro(92753, "en")).toBe("92,753 €");
  });

  it("uses dot thousands separators in de locale", () => {
    expect(euro(92753, "de-DE")).toBe("92.753 €");
  });
});

describe("percent", () => {
  it("appends a space before % in de locale", () => {
    expect(percent(3.1, "de-DE")).toBe("3,1 %");
  });

  it("appends no space before % in en locale", () => {
    expect(percent(3.1, "en")).toBe("3.1%");
  });
});

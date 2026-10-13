import { describe, expect, test } from "bun:test";
import { noticePeriodEnd } from "../features/rental/lease-support";

describe("noticePeriodEnd", () => {
  test("notice by the 3rd ends the lease after the month after next", () => {
    expect(noticePeriodEnd("2026-10-02")).toBe("2026-12-31");
    expect(noticePeriodEnd("2026-10-03")).toBe("2026-12-31");
  });

  test("later notice ends the lease one month later", () => {
    expect(noticePeriodEnd("2026-10-13")).toBe("2027-01-31");
    expect(noticePeriodEnd("2026-11-30")).toBe("2027-02-28");
  });
});

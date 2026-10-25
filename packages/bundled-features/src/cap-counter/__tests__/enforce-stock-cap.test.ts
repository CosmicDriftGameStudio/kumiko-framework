import { describe, expect, test } from "bun:test";
import { enforceStockCap } from "../enforce-cap.ts";

describe("enforceStockCap", () => {
  test("hardSlot: limit is exact (no buffer)", () => {
    const at = (current: number) => enforceStockCap({ current, limit: 5, profile: "hardSlot" });
    expect(at(0).state).toBe("ok");
    expect(at(4).state).toBe("ok");
    // A tenant with 5 items is blocked from creating a 6th (`current=5 >= 5`).
    expect(at(5).state).toBe("exceeded");
    expect(at(6).state).toBe("exceeded");
  });

  test("storage: 5% buffer above the limit", () => {
    const at = (current: number) => enforceStockCap({ current, limit: 100, profile: "storage" });
    expect(at(104).state).toBe("ok"); // 104 < 105 (=100×1.05)
    expect(at(105).state).toBe("exceeded");
  });

  test("burstable: 20% Buffer", () => {
    const at = (current: number) => enforceStockCap({ current, limit: 10, profile: "burstable" });
    expect(at(11).state).toBe("ok"); // 11 < 12 (=10×1.2)
    expect(at(12).state).toBe("exceeded");
  });

  test("limit 0 = no allowance → every insertion is exceeded", () => {
    expect(enforceStockCap({ current: 0, limit: 0, profile: "hardSlot" }).state).toBe("exceeded");
  });

  test("Result includes current + limit for the caller error message", () => {
    expect(enforceStockCap({ current: 7, limit: 5, profile: "hardSlot" })).toEqual({
      state: "exceeded",
      current: 7,
      limit: 5,
    });
  });
});

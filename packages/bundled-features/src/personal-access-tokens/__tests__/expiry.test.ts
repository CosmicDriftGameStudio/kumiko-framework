import { describe, expect, it } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { isExpiredAt } from "../expiry";

describe("isExpiredAt", () => {
  it("null never expires", () => {
    expect(isExpiredAt(null)).toBe(false);
  });

  it("a future instant is not expired", () => {
    const future = Temporal.Now.instant().add({ hours: 1 });
    expect(isExpiredAt({ epochMilliseconds: future.epochMilliseconds })).toBe(false);
  });

  it("a past instant is expired", () => {
    const past = Temporal.Now.instant().subtract({ hours: 1 });
    expect(isExpiredAt({ epochMilliseconds: past.epochMilliseconds })).toBe(true);
  });
});

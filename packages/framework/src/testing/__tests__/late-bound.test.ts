import { describe, expect, test } from "bun:test";
import { createLateBoundHolder } from "../late-bound";

describe("createLateBoundHolder", () => {
  test("isReady is false and get() throws before set()", () => {
    const holder = createLateBoundHolder<number>("thing");
    expect(holder.isReady()).toBe(false);
    expect(() => holder.get()).toThrow(/thing accessed before set\(\) was called/);
  });

  test("get() returns the stored value after set()", () => {
    const holder = createLateBoundHolder<{ n: number }>();
    const value = { n: 42 };
    holder.set(value);
    expect(holder.isReady()).toBe(true);
    expect(holder.get()).toBe(value);
  });

  test("set() can be called again to replace the value", () => {
    const holder = createLateBoundHolder<string>();
    holder.set("first");
    holder.set("second");
    expect(holder.get()).toBe("second");
  });
});

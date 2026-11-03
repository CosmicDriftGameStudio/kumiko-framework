import { describe, expect, test } from "bun:test";
import { withProviderCallTimeout } from "../consumer-protection/termination-provider-timeout.ts";

describe("withProviderCallTimeout", () => {
  test("rejects when the provider call never settles", async () => {
    const hanging = new Promise<void>(() => {});
    await expect(withProviderCallTimeout(hanging, 5)).rejects.toThrow("exceeded 5 ms");
  });

  test("passes a result and a provider error through unchanged", async () => {
    expect(await withProviderCallTimeout(Promise.resolve("ok"), 1000)).toBe("ok");
    await expect(withProviderCallTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow(
      "boom",
    );
  });
});

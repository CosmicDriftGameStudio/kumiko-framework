import { describe, expect, test } from "bun:test";
import { Temporal } from "../temporal.js";

describe("kumiko-types/temporal", () => {
  test("resolves to the native global when present", () => {
    expect(Temporal).toBe(globalThis.Temporal);
  });

  test("installs the polyfill on globalThis when no native Temporal exists", async () => {
    const saved = globalThis.Temporal;
    Reflect.deleteProperty(globalThis, "Temporal");
    try {
      const freshModuleSpecifier = "../temporal.js?no-native-temporal";
      const fresh: { Temporal: typeof Temporal } = await import(freshModuleSpecifier);
      expect(globalThis.Temporal).toBe(fresh.Temporal);
      expect(fresh.Temporal).not.toBe(saved);
      expect(fresh.Temporal.Instant.from("2026-01-01T00:00:00Z").toString()).toBe(
        "2026-01-01T00:00:00Z",
      );
    } finally {
      Object.assign(globalThis, { Temporal: saved });
    }
  });
});

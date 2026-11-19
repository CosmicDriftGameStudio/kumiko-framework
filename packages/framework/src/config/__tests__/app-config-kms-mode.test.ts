import { describe, expect, test } from "bun:test";
import { type AppConfig, defineAppConfig } from "../index.ts";

const baseConfig: AppConfig = {
  features: [],
  client: { entries: ["src/client.tsx"] },
  ports: { dev: 4173, e2e: 4174 },
};

describe("defineAppConfig :: kmsMode", () => {
  test.each([
    { kmsMode: "required" },
    { kmsMode: "optional" },
    { kmsMode: { plaintextReason: "demo app without customer data" } },
    {},
  ] as const)("accepts %o", (override) => {
    const config = { ...baseConfig, ...override };
    expect(defineAppConfig(config)).toBe(config);
  });

  test("rejects a plaintext mode without a reason", () => {
    expect(() => defineAppConfig({ ...baseConfig, kmsMode: { plaintextReason: "  " } })).toThrow(
      "kmsMode.plaintextReason must name a reason",
    );
  });

  test("rejects a typo with the allowed modes in the message", () => {
    // The cast stands in for an untyped kumiko.config.ts value reaching the runtime check.
    const typo = "requird" as AppConfig["kmsMode"];
    expect(() => defineAppConfig({ ...baseConfig, kmsMode: typo })).toThrow(
      "kmsMode must be one of required, optional or { plaintextReason }, got requird",
    );
  });
});

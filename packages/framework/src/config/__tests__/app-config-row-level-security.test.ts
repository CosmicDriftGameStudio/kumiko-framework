import { describe, expect, test } from "bun:test";
import { type AppConfig, defineAppConfig } from "../index.ts";

const baseConfig: AppConfig = {
  features: [],
  client: { entries: ["src/client.tsx"] },
  ports: { dev: 4173, e2e: 4174 },
};

describe("defineAppConfig :: rowLevelSecurity", () => {
  test.each([{ rowLevelSecurity: "on" }, { rowLevelSecurity: "off" }, {}] as const)(
    "accepts %o",
    (override) => {
      const config = { ...baseConfig, ...override };
      expect(defineAppConfig(config)).toBe(config);
    },
  );

  test("rejects a typo with the allowed modes in the message", () => {
    // The cast stands in for an untyped kumiko.config.ts value reaching the runtime check.
    const typo = "of" as AppConfig["rowLevelSecurity"];
    expect(() => defineAppConfig({ ...baseConfig, rowLevelSecurity: typo })).toThrow(
      "rowLevelSecurity must be one of off, on, got of",
    );
  });
});

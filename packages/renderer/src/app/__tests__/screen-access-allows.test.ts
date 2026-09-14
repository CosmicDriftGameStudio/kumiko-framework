import { describe, expect, test } from "bun:test";
import type { AccessRule } from "@cosmicdrift/kumiko-framework/ui-types";
import { screenAccessAllows } from "../kumiko-screen";

describe("screenAccessAllows", () => {
  test("allows when no access rule is set", () => {
    expect(screenAccessAllows(undefined, undefined)).toBe(true);
  });

  test("openToAll with a reason allows regardless of roles", () => {
    expect(
      screenAccessAllows(
        { openToAll: { reason: "test handler callable by any signed-in test user" } },
        undefined,
      ),
    ).toBe(true);
  });

  test("the deprecated openToAll: true form denies — fail-closed", () => {
    expect(screenAccessAllows({ openToAll: true } as unknown as AccessRule, undefined)).toBe(false);
  });

  test("roles-gated allows a matching role", () => {
    expect(screenAccessAllows({ roles: ["Admin"] }, ["Admin"])).toBe(true);
  });

  test("roles-gated denies with no matching role", () => {
    expect(screenAccessAllows({ roles: ["Admin"] }, ["Member"])).toBe(false);
  });

  test("roles-gated denies when userRoles is undefined", () => {
    expect(screenAccessAllows({ roles: ["Admin"] }, undefined)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { screenAccessAllows } from "../kumiko-screen";

describe("screenAccessAllows", () => {
  test("allows when no access rule is set", () => {
    expect(screenAccessAllows(undefined, undefined)).toBe(true);
  });

  test("openToAll: true allows regardless of roles", () => {
    expect(screenAccessAllows({ openToAll: true }, undefined)).toBe(true);
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

import { describe, expect, test } from "bun:test";
import { isUiAccessGranted } from "../handlers";

describe("isUiAccessGranted", () => {
  test("unset access is visible to every signed-in user", () => {
    expect(isUiAccessGranted(undefined, [])).toBe(true);
    expect(isUiAccessGranted(undefined, undefined)).toBe(true);
  });

  test("openToAll with a non-empty reason grants regardless of roles", () => {
    expect(isUiAccessGranted({ openToAll: { reason: "any signed-in user" } }, [])).toBe(true);
    expect(isUiAccessGranted({ openToAll: { reason: "any signed-in user" } }, undefined)).toBe(
      true,
    );
  });

  test("openToAll with a blank reason denies — malformed/untyped input narrowed defensively", () => {
    expect(isUiAccessGranted({ openToAll: { reason: "   " } }, [])).toBe(false);
  });

  test("roles rule grants on overlap", () => {
    expect(isUiAccessGranted({ roles: ["Admin", "SystemAdmin"] }, ["User", "Admin"])).toBe(true);
  });

  test("roles rule denies without overlap", () => {
    expect(isUiAccessGranted({ roles: ["Admin"] }, ["User"])).toBe(false);
  });

  test("roles rule denies when caller has no roles", () => {
    expect(isUiAccessGranted({ roles: ["Admin"] }, [])).toBe(false);
  });

  test("roles rule denies when caller roles are undefined", () => {
    expect(isUiAccessGranted({ roles: ["Admin"] }, undefined)).toBe(false);
  });

  test("empty roles rule denies everyone (explicit default-deny opt-in)", () => {
    expect(isUiAccessGranted({ roles: [] }, ["Admin"])).toBe(false);
  });
});

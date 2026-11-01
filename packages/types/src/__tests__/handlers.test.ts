import { describe, expect, test } from "bun:test";
import { type HandlerContext, isUiAccessGranted } from "../handlers.ts";

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

  test("anySignedIn on a public rule grants every signed-in role and keeps anonymous", () => {
    const publicRule = { roles: ["anonymous"], anySignedIn: true } as const;
    expect(isUiAccessGranted(publicRule, ["Hausmeister"])).toBe(true);
    expect(isUiAccessGranted(publicRule, ["anonymous"])).toBe(true);
  });

  test("anySignedIn without the anonymous role grants nothing extra", () => {
    expect(isUiAccessGranted({ roles: ["Admin"], anySignedIn: true }, ["Hausmeister"])).toBe(false);
  });
});

describe("HandlerContext surface", () => {
  test("the deprecated outsideTransaction field is gone", () => {
    const outsideTransactionRemoved: "outsideTransaction" extends keyof HandlerContext
      ? never
      : true = true;
    expect(outsideTransactionRemoved).toBe(true);
  });
});

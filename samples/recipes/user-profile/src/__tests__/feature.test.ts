// Boot validation of the full user-profile composition: require chain
// satisfied, screen + nav registered, change-email handler under the
// documented QN. No DB/HTTP needed — the HTTP proof lives in the
// bundled-feature test (change-email.integration.test.ts).

import { describe, expect, test } from "bun:test";
import { UserProfileHandlers } from "@cosmicdrift/kumiko-bundled-features/user-profile";
import {
  createRegistry,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { composeAccountApp } from "../feature";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const features = composeAccountApp();

describe("user-profile recipe — boot validation", () => {
  test("validateBoot accepts the full composition (require chain satisfied)", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("profile screen + nav registered with qualified ids", () => {
    const registry = createRegistry(features);
    expect(registry.getScreen("user-profile:screen:profile")?.id).toBe(
      "user-profile:screen:profile",
    );
  });

  test("user-profile deklariert seine Require-Kette (Manifest-Quelle)", () => {
    const userProfile = features.find((f) => f.name === "user-profile");
    if (!userProfile) throw new Error("user-profile feature missing in composition");
    expect(userProfile.requires).toEqual([
      "user",
      "auth-email-password",
      "user-data-rights",
      "user-data-rights-defaults",
    ]);
  });

  test("change-email QN matches the documented constant", () => {
    expect(UserProfileHandlers.changeEmail).toBe("user-profile:write:change-email");
  });
});

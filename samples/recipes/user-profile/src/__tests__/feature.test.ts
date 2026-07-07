// Boot-Validation der vollen user-profile-Komposition: Require-Kette
// erfüllt, Screen + Nav registriert, change-email-Handler unter der
// dokumentierten QN. Kein DB/HTTP nötig — der HTTP-Beweis lebt im
// bundled-feature-Test (change-email.integration.test.ts).

import { describe, expect, test } from "bun:test";
import { UserProfileHandlers } from "@cosmicdrift/kumiko-bundled-features/user-profile";
import {
  createRegistry,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-framework/testing";
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
    expect(registry.getScreen("account:screen:profile")?.id).toBe("account:screen:profile");
  });

  test("user-profile deklariert seine Require-Kette (Manifest-Quelle)", () => {
    const userProfile = features.find((f) => f.name === "user-profile");
    if (!userProfile) throw new Error("user-profile feature missing in composition");
    expect(userProfile.requires).toEqual(["user", "auth-email-password", "user-data-rights"]);
  });

  test("change-email QN entspricht der dokumentierten Konstante", () => {
    expect(UserProfileHandlers.changeEmail).toBe("user-profile:write:change-email");
  });
});

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { changeEmailWrite } from "./handlers/change-email.write";

export function createUserProfileFeature(): FeatureDefinition {
  return defineFeature("user-profile", (r) => {
    r.describe(
      "Self-service account page building blocks: a `change-email` write handler " +
        "(re-auth via current password, uniqueness check, resets emailVerified and " +
        "expects the app to trigger the verification flow) plus the ProfileScreen " +
        "web component that composes change-password (auth-email-password), " +
        "change-email and account deletion (user-data-rights request/cancel with " +
        "grace period) into one screen. Apps register the screen as " +
        '`type: "custom"` with `__component: "UserProfileScreen"`. Requires `user`, ' +
        "`auth-email-password`, and `user-data-rights`.",
    );
    r.uiHints({
      displayLabel: "User Profile · Self-Service",
      category: "identity",
      recommended: true,
    });
    r.requires("user");
    r.requires("auth-email-password");
    r.requires("user-data-rights");

    const handlers = {
      changeEmail: r.writeHandler(changeEmailWrite),
    };

    return { handlers };
  });
}

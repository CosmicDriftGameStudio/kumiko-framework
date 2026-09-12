import {
  defineFeature,
  type FeatureDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  CHANGE_EMAIL_SECTION_EXTENSION_NAME,
  CHANGE_PASSWORD_SECTION_EXTENSION_NAME,
  PROFILE_SCREEN_ID,
  UserDataRightsHandlers,
  UserProfileQueries,
} from "./constants";
import { changeEmailWrite } from "./handlers/change-email.write";

export function createUserProfileFeature(): FeatureDefinition {
  return defineFeature("user-profile", (r) => {
    r.describe(
      "Self-service account page (fw#2312: declarative `projectionDetail` bound to " +
        "the signed-in user's own `me` row) plus its `change-email` write handler " +
        "(re-auth via current password, uniqueness check, resets emailVerified and " +
        "expects the app to trigger the verification flow). Change-password and " +
        "change-email stay custom `EditExtensionSection` components (re-auth flows a " +
        "declarative action can't express); account deletion (user-data-rights " +
        "request/cancel with grace period) is declarative fields + actions. Apps " +
        'place the screen (id "profile") in their logged-in area via r.nav — no ' +
        '`type: "custom"` / `__component` registration needed on the app side ' +
        "anymore. Requires `user`, `auth-email-password`, `user-data-rights`, and " +
        "`user-data-rights-defaults` (so the GDPR boot-validator finds export/delete " +
        "hooks for `user`'s PII fields once user-data-rights is mounted).",
    );
    r.uiHints({
      displayLabel: "User Profile · Self-Service",
      category: "identity",
      recommended: true,
    });
    r.requires("user");
    r.requires("auth-email-password");
    r.requires("user-data-rights");
    r.requires("user-data-rights-defaults");

    const handlers = {
      changeEmail: r.writeHandler(changeEmailWrite),
    };

    // Boot-validator requires a "screen:<id>.title" key per r.screen(), plus
    // one entry per i18nKey()-marked dot-form label below — kept inline (not
    // imported from ./i18n) so feature.ts, part of the server barrel, stays
    // importable from a server-only sample without a jsx tsconfig (i18n.ts
    // pulls @cosmicdrift/kumiko-renderer's types, see index.ts). Values are
    // duplicated in i18n.ts's client bundle.
    r.translations({
      keys: {
        "screen:profile.title": { en: "Profile" },
        "profile.email.title": { en: "Email address" },
        "profile.password.title": { en: "Password" },
        "profile.danger.title": { en: "Delete account" },
        "profile.danger.gracePeriodEnd": { en: "Deletion date" },
        "profile.danger.delete": { en: "Delete account" },
        "profile.danger.dialogDescription": {
          en: "After the grace period your data will be permanently deleted. Until then you can cancel.",
        },
        "profile.danger.cancelDeletion": { en: "Cancel deletion" },
      },
    });

    // Self-service account screen: change-email/change-password stay
    // self-persisting extension sections (re-auth, own dispatcher writes —
    // contributesToFormSubmit omitted since projectionDetail has no form
    // submit of its own, see the boot-validator's check for that). Deletion
    // is declarative fields + actions, same split as user-data-rights'
    // privacy-center screen (../user-data-rights/feature.ts) which this
    // mirrors 1:1 for the confirm/visible semantics. access is openToAll
    // because no app role name is portable; the per-user handlers enforce
    // auth server-side.
    r.screen({
      id: PROFILE_SCREEN_ID,
      type: "projectionDetail",
      query: UserProfileQueries.me,
      singleton: true,
      access: { openToAll: true },
      description:
        "Self-service account page: change password, change email (with re-auth and " +
        "a verification-mail follow-up), and request or cancel account deletion " +
        "(user-data-rights grace period).",
      fieldLabels: {
        gracePeriodEnd: i18nKey("profile.danger.gracePeriodEnd"),
      },
      layout: {
        sections: [
          {
            kind: "extension",
            title: i18nKey("profile.email.title"),
            component: { react: { __component: CHANGE_EMAIL_SECTION_EXTENSION_NAME } },
            entityName: "user",
          },
          {
            kind: "extension",
            title: i18nKey("profile.password.title"),
            component: { react: { __component: CHANGE_PASSWORD_SECTION_EXTENSION_NAME } },
            entityName: "user",
          },
          {
            title: i18nKey("profile.danger.title"),
            description: "profile.danger.explainer",
            // gracePeriodEnd is only meaningful once a deletion is actually
            // pending — hide it instead of showing an empty date when status
            // isn't deletionRequested (same rule as privacy-center).
            fields: [
              {
                field: "gracePeriodEnd",
                renderer: { format: "date" as const },
                visible: { field: "status", eq: "deletionRequested" },
              },
            ],
          },
        ],
      },
      actions: [
        {
          id: "request-deletion",
          label: i18nKey("profile.danger.delete"),
          handler: UserDataRightsHandlers.requestDeletion,
          confirm: i18nKey("profile.danger.dialogDescription"),
          visible: { field: "status", ne: "deletionRequested" },
          style: "danger",
        },
        {
          id: "cancel-deletion",
          label: i18nKey("profile.danger.cancelDeletion"),
          handler: UserDataRightsHandlers.cancelDeletion,
          visible: { field: "status", eq: "deletionRequested" },
          style: "secondary",
        },
      ],
    });

    return { handlers };
  });
}

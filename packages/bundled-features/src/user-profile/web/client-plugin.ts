// @runtime client
import {
  type ExtensionSectionComponent,
  mergeTranslations,
  type TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer";
import type { ComponentType, ReactNode } from "react";
import {
  CHANGE_EMAIL_SECTION_EXTENSION_NAME,
  CHANGE_PASSWORD_SECTION_EXTENSION_NAME,
} from "../constants";
import { defaultTranslations } from "../i18n";
import { ChangeEmailSection, ChangePasswordSection } from "./profile-screen";

export type UserProfileClientOptions = {
  /** Per-key overrides on top of the default bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export type UserProfileClientFeature = {
  readonly name: "user-profile";
  readonly providers: readonly ComponentType<{ children: ReactNode }>[];
  readonly gates: readonly ComponentType<{ children: ReactNode }>[];
  readonly translations: TranslationsByLocale;
  readonly extensionSectionComponents: Readonly<Record<string, ExtensionSectionComponent>>;
};

// Supplies the ChangeEmail/ChangePassword extension components for the
// declarative `profile` projectionDetail screen (fw#2312, ../feature.ts,
// registered there server-side) plus the default translations. Apps add it
// via createKumikoApp({ clientFeatures: [userProfileClient()] }) and place
// the screen (id "profile") via r.nav — the screen itself has no r.nav of
// its own, same as user-data-rights' privacy-center.
export function userProfileClient(options?: UserProfileClientOptions): UserProfileClientFeature {
  return {
    name: "user-profile",
    providers: [],
    gates: [],
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    extensionSectionComponents: {
      [CHANGE_EMAIL_SECTION_EXTENSION_NAME]: ChangeEmailSection,
      [CHANGE_PASSWORD_SECTION_EXTENSION_NAME]: ChangePasswordSection,
    },
  };
}

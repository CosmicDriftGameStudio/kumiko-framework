// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ComponentType, ReactNode } from "react";
import { defaultTranslations } from "../i18n";

export type UserProfileClientOptions = {
  /** Key-weise Overrides über die Default-Bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export type UserProfileClientFeature = {
  readonly name: "user-profile";
  readonly providers: readonly ComponentType<{ children: ReactNode }>[];
  readonly gates: readonly ComponentType<{ children: ReactNode }>[];
  readonly translations: TranslationsByLocale;
};

// Liefert nur Translations — der ProfileScreen selbst wird von der App
// als custom-Screen registriert (__component: "UserProfileScreen"),
// damit Nav-Platzierung + Access bei der App bleiben.
export function userProfileClient(options?: UserProfileClientOptions): UserProfileClientFeature {
  return {
    name: "user-profile",
    providers: [],
    gates: [],
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}

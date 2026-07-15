// @runtime client
// Client-Feature-Factory für auth-mfa — mirrors emailPasswordClient()'s
// shape so apps register both the same way:
// createKumikoApp({ clientFeatures: [emailPasswordClient(), authMfaClient()] }).
// No providers/gates: MfaVerifyScreen isn't a route gate, it's a state
// swap the app triggers from LoginScreen's onMfaChallenge — this factory
// only merges the default de/en translations into the app's locale bundle.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ComponentType, ReactNode } from "react";
import { defaultTranslations, mergeTranslations } from "../i18n";

export type AuthMfaClientOptions = {
  /** Key-Overrides pro Locale, gemerged mit den Default-Bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export type AuthMfaClientFeature = {
  readonly name: "auth-mfa";
  readonly providers: readonly ComponentType<{ children: ReactNode }>[];
  readonly gates: readonly ComponentType<{ children: ReactNode }>[];
  readonly translations: TranslationsByLocale;
};

export function authMfaClient(options: AuthMfaClientOptions = {}): AuthMfaClientFeature {
  return {
    name: "auth-mfa",
    providers: [],
    gates: [],
    translations: mergeTranslations(defaultTranslations, options.translations ?? {}),
  };
}

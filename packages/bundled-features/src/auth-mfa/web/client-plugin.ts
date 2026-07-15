// @runtime client
// Client-Feature-Factory für auth-mfa — mirrors emailPasswordClient()'s
// shape so apps register both the same way:
// createKumikoApp({ clientFeatures: [emailPasswordClient(), authMfaClient()] }).
// No gates: MfaVerifyScreen isn't a route gate, it's a state swap wired
// via EmailPasswordClientOptions.mfaVerifyScreen. This factory merges the
// default de/en translations and maps MFA_ENABLE_SCREEN_ID to
// MfaEnableScreen (same "components" convention as personal-access-tokens).

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ComponentType, ReactNode } from "react";
import { MFA_ENABLE_SCREEN_ID } from "../constants";
import { defaultTranslations, mergeTranslations } from "../i18n";
import { MfaEnableScreen } from "./mfa-enable-screen";

export type AuthMfaClientOptions = {
  /** Key-Overrides pro Locale, gemerged mit den Default-Bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export type AuthMfaClientFeature = {
  readonly name: "auth-mfa";
  readonly providers: readonly ComponentType<{ children: ReactNode }>[];
  readonly gates: readonly ComponentType<{ children: ReactNode }>[];
  readonly translations: TranslationsByLocale;
  readonly components: Readonly<Record<string, ComponentType>>;
};

export function authMfaClient(options: AuthMfaClientOptions = {}): AuthMfaClientFeature {
  return {
    name: "auth-mfa",
    providers: [],
    gates: [],
    translations: mergeTranslations(defaultTranslations, options.translations ?? {}),
    components: { [MFA_ENABLE_SCREEN_ID]: MfaEnableScreen },
  };
}

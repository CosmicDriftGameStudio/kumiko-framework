// @runtime client
// Client-Feature-Factory für auth-email-password. Wird vom App-Code
// in createKumikoApp({ clientFeatures: [emailPasswordClient()] })
// eingehängt und bringt Session-Context + AuthGate + Default-UI-
// Translations (de/en) mit. Alles ist overridbar — Login-Screen,
// Strings pro Locale, pro Key.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ComponentType, ReactNode } from "react";
import { defaultTranslations, mergeTranslations } from "../i18n";
import { type MfaVerifyComponentProps, makeSessionAuthGate } from "./auth-gate";
import type { LoginScreenProps } from "./login-screen";

export type EmailPasswordClientOptions = {
  /** Eigener Login-Screen. Default: der shadcn-stylte LoginScreen
   *  aus diesem Modul. Für Branding- oder Layout-Overrides einfach
   *  eine eigene Komponente mit derselben Signatur reichen. */
  readonly loginScreen?: ComponentType<LoginScreenProps>;
  readonly loginScreenProps?: LoginScreenProps;
  /** auth-mfa's MfaVerifyScreen, wired in from the app so this feature
   *  stays unaware of auth-mfa's concrete shape. When LoginScreen's
   *  onMfaChallenge fires, the gate swaps to this component instead of
   *  requiring the app to own that state itself. Apps not mounting
   *  auth-mfa simply don't pass this — LoginScreen's built-in fallback
   *  error covers that case. */
  readonly mfaVerifyScreen?: ComponentType<MfaVerifyComponentProps>;
  /** Key-Overrides pro Locale. Wird mit den Default-Bundles (de/en)
   *  aus `translations.ts` gemerged — jeder hier gesetzte Key gewinnt.
   *  Für Branding ("Sign in" → "Login to Acme") oder weitere Sprachen
   *  (`fr`, `es`, …) zusätzlich. */
  readonly translations?: TranslationsByLocale;
};

// Struktural identisch zur renderer-web ClientFeatureDefinition, aber
// ohne harte Dep auf @cosmicdrift/kumiko-renderer-web — so bleibt das Feature auch
// für React-Native-Renderer (wenn sie kommen) nutzbar.
export type EmailPasswordClientFeature = {
  readonly name: "auth-email-password";
  readonly providers: readonly ComponentType<{ children: ReactNode }>[];
  readonly gates: readonly ComponentType<{ children: ReactNode }>[];
  readonly translations: TranslationsByLocale;
};

export function emailPasswordClient(
  options: EmailPasswordClientOptions = {},
): EmailPasswordClientFeature {
  const translations = mergeTranslations(defaultTranslations, options.translations ?? {});
  return {
    name: "auth-email-password",
    providers: [],
    gates: [
      makeSessionAuthGate(options.loginScreen, options.loginScreenProps, options.mfaVerifyScreen),
    ],
    translations,
  };
}

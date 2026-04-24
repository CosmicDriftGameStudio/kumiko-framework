// Client-Feature-Factory für auth-email-password. Wird vom App-Code
// in createKumikoApp({ clientFeatures: [emailPasswordClient()] })
// eingehängt und bringt Session-Context + AuthGate + Default-UI-
// Translations (de/en) mit. Alles ist overridbar — Login-Screen,
// Strings pro Locale, pro Key.

import type { TranslationsByLocale } from "@kumiko/renderer";
import type { ComponentType, ReactNode } from "react";
import { makeAuthGate } from "./auth-gate";
import type { LoginScreenProps } from "./login-screen";
import { SessionProvider } from "./session";
import { defaultTranslations, mergeTranslations } from "./translations";

export type EmailPasswordClientOptions = {
  /** Eigener Login-Screen. Default: der shadcn-stylte LoginScreen
   *  aus diesem Modul. Für Branding- oder Layout-Overrides einfach
   *  eine eigene Komponente mit derselben Signatur reichen. */
  readonly loginScreen?: ComponentType<LoginScreenProps>;
  readonly loginScreenProps?: LoginScreenProps;
  /** Key-Overrides pro Locale. Wird mit den Default-Bundles (de/en)
   *  aus `translations.ts` gemerged — jeder hier gesetzte Key gewinnt.
   *  Für Branding ("Sign in" → "Login to Acme") oder weitere Sprachen
   *  (`fr`, `es`, …) zusätzlich. */
  readonly translations?: TranslationsByLocale;
};

// Struktural identisch zur renderer-web ClientFeatureDefinition, aber
// ohne harte Dep auf @kumiko/renderer-web — so bleibt das Feature auch
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
    providers: [SessionProvider],
    gates: [makeAuthGate(options.loginScreen, options.loginScreenProps)],
    translations,
  };
}

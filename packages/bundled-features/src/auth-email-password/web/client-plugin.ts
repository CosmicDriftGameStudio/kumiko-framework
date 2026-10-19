// @runtime client
// Client-Feature-Factory für auth-email-password. Wird vom App-Code
// in createKumikoApp({ clientFeatures: [emailPasswordClient()] })
// eingehängt und bringt Session-Context + AuthGate + Default-UI-
// Translations (de/en) mit. Alles ist overridbar — Login-Screen,
// Strings pro Locale, pro Key.

import type { ClientActionHandler, TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ComponentType, ReactNode } from "react";
import { defaultTranslations, mergeTranslations } from "../i18n.ts";
import {
  type AuthGateOptions,
  type MfaSetupComponentProps,
  type MfaVerifyComponentProps,
  makeSessionAuthGate,
} from "./auth-gate.tsx";
import { emailPasswordClientActions } from "./client-actions.ts";
import type { LoginScreenProps } from "./login-screen.tsx";

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
  /** auth-mfa's MfaSetupPreauthScreen, wired in from the app the same way
   *  as mfaVerifyScreen above. Apps not mounting auth-mfa simply don't
   *  pass this. */
  readonly mfaSetupScreen?: ComponentType<MfaSetupComponentProps>;
  /** Login page outside the SPA (root-relative path or http(s) URL). Unauthenticated
   *  visitors are redirected there with `next=<current path>` instead of seeing the
   *  built-in login screen. Read `next` back with readNextFromSearch (same-origin
   *  paths only). */
  readonly loginUrl?: AuthGateOptions["loginUrl"];
  /** Where logout navigates to (root-relative path or http(s) URL). Default: reload. */
  readonly postLogoutUrl?: string;
  /** Key-Overrides pro Locale. Wird mit den Default-Bundles (de/en)
   *  aus `translations.ts` gemerged — jeder hier gesetzte Key gewinnt.
   *  Für Branding ("Sign in" → "Login to Acme") oder weitere Sprachen
   *  (`fr`, `es`, …) zusätzlich. */
  readonly translations?: TranslationsByLocale;
};

// Structurally identical to the renderer/web ClientFeatureDefinition, but
// without a hard dependency on @cosmicdrift/kumiko-renderer/web, so the feature
// stays usable by other renderers.
export type EmailPasswordClientFeature = {
  readonly name: "auth-email-password";
  readonly providers: readonly ComponentType<{ children: ReactNode }>[];
  readonly gates: readonly ComponentType<{ children: ReactNode }>[];
  readonly translations: TranslationsByLocale;
  readonly clientActions: Readonly<Record<string, ClientActionHandler>>;
};

export function emailPasswordClient(
  options: EmailPasswordClientOptions = {},
): EmailPasswordClientFeature {
  const translations = mergeTranslations(defaultTranslations, options.translations ?? {});
  return {
    name: "auth-email-password",
    providers: [],
    gates: [
      makeSessionAuthGate({
        loginScreen: options.loginScreen,
        loginScreenProps: options.loginScreenProps,
        mfaVerifyScreen: options.mfaVerifyScreen,
        mfaSetupScreen: options.mfaSetupScreen,
        loginUrl: options.loginUrl,
        postLogoutUrl: options.postLogoutUrl,
      }),
    ],
    translations,
    clientActions: emailPasswordClientActions,
  };
}

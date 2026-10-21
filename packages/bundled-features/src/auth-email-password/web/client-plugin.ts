// Client feature factory for auth-email-password. App code mounts it in
// createKumikoApp({ clientFeatures: [emailPasswordClient()] }) to provide
// session context, AuthGate, and default UI translations (de/en). All of
// these can be overridden: the login screen and strings per locale and key.

import type { ClientActionHandler, TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ComponentType, ReactNode } from "react";
import {
  type AuthGateOptions,
  type MfaSetupComponentProps,
  type MfaVerifyComponentProps,
  makeSessionAuthGate,
} from "./auth-gate.tsx";
import { emailPasswordClientActions } from "./client-actions.ts";
import { DefaultAuthPagesGate } from "./default-auth-pages-gate.tsx";
import { defaultTranslations, mergeTranslations } from "./i18n.ts";
import type { LoginScreenProps } from "./login-screen.tsx";

export type EmailPasswordClientOptions = {
  /** Custom login screen. Default: the shadcn-styled LoginScreen
   *  from this module. Provide a component with the same signature for
   *  branding or layout overrides. */
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
  /** Per-locale key overrides. Merged with the default bundles (de/en)
   *  from `translations.ts`; each key supplied here takes precedence.
   *  Use this for branding ("Sign in" → "Login to Acme") or to add
   *  further languages (`fr`, `es`, …). */
  readonly translations?: TranslationsByLocale;
  /** Serve the forgot-password, reset-password and unlock-account pages at
   *  their convention paths for signed-out visitors. Apps with their own
   *  screens at those paths either register an earlier gate (it wins) or
   *  set this to false. Default: true. */
  readonly defaultAuthPages?: boolean;
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
      ...(options.defaultAuthPages === false ? [] : [DefaultAuthPagesGate]),
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

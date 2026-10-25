// apex-surface-auth recipe — the evident way for public apex content.
//
// A Kumiko app has a public apex presence (landing/login) AND a
// schema-driven admin UI. The admin UI mounts via createKumikoApp (full
// schema). The apex mounts via createPublicSurface — schema-LESS, anonymously
// reachable, no admin nav/topology leak. Both share locale + primitives.
//
// This recipe shows:
//   1. Server: the feature composition for the 4 account flows + the anonymous,
//      email-verified deletion flow (lockout-safe).
//   2. Client (comment below + README): how createPublicSurface + AuthShell
//      mount the screens in the apex chrome.
//
// CLIENT-WIRING (the app's apex.tsx — renderer/web, only a reference here, since
// recipes pull in no browser deps):
//
//   import {
//     ForgotPasswordScreen, SignupScreen, createLoginRoute,
//     AuthShellProvider, emailPasswordClient,
//   } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
//   import {
//     RequestAccountDeletionScreen, ConfirmAccountDeletionScreen,
//     defaultTranslations as deletionI18n,
//   } from "@cosmicdrift/kumiko-bundled-features/user-data-rights/web";
//   import { createPublicSurface } from "@cosmicdrift/kumiko-renderer/web";
//
//   // AuthShell: the auth card renders inside the marketing chrome instead of
//   // fullscreen. Default (without a provider) stays the fullscreen wrapper.
//   const shell = ({ children }) => (
//     <MarketingChrome>
//       <AuthShellProvider shell={(card) => <div className="py-12 flex justify-center">{card}</div>}>
//         {children}
//       </AuthShellProvider>
//     </MarketingChrome>
//   );
//
//   // createLoginRoute — do NOT render LoginScreen directly: the route
//   // needs the challenge-swap logic for a second factor. Without it
//   // (e.g. a raw <LoginScreen />) an MFA-enrolled user gets stuck at login
//   // as soon as the app mounts auth-mfa at some point. If the app mounts
//   // auth-mfa, add `mfaVerifyScreen: MfaVerifyScreen` (from
//   // "@cosmicdrift/kumiko-bundled-features/auth-mfa/web").
//   const LoginRoute = createLoginRoute({ loginScreenProps: { signupHref: "/signup" } });
//
//   createPublicSurface({
//     clientFeatures: [emailPasswordClient()],   // bringt SessionProvider + i18n
//     shell,
//     routes: [
//       { path: "/login",            component: <LoginRoute /> },
//       { path: "/signup",           component: <SignupScreen loginHref="/login" /> },
//       { path: "/forgot-password",  component: <ForgotPasswordScreen loginHref="/login" /> },
//       { path: "/delete-account",          component: <RequestAccountDeletionScreen /> },
//       { path: "/delete-account/confirm",  component: <ConfirmAccountDeletionScreen /> },
//     ],
//     fallback: <LoginRoute />,
//   });
//
//
// SERVER-WIRING: the app enables `anonymousAccess` (defaultTenantId = the
// apex host tenant) so /api/write reaches the anonymous deletion handlers:
//
//   runProdApp({ features: composeApexAccountApp({...}), envSchema,
//                anonymousAccess: { defaultTenantId: APEX_TENANT_ID } })

import { createAuthEmailPasswordFeature } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  createUserDataRightsFeature,
  type SendDeletionVerificationEmailFn,
} from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export type ApexAccountAppOptions = {
  /** HMAC secret for the deletion verify token. */
  readonly deletionTokenSecret: string;
  /** Apex route of the confirm screen; the handler appends the token as a
   *  URL fragment (`#token=`). */
  readonly deletionVerifyUrl: string;
  /** Sending the verify magic link. MUST be non-blocking (enqueue) — a
   *  synchronous send would open a timing oracle for account enumeration. */
  readonly sendDeletionVerificationEmail: SendDeletionVerificationEmailFn;
};

// Full feature composition for the public account flows. The
// user-data-rights options enable the anonymous deletion flow; the remaining
// features provide login/register/PW (auth-email-password) + the
// require chain (user-data-rights → data-retention + compliance-profiles +
// sessions).
export function composeApexAccountApp(opts: ApexAccountAppOptions): FeatureDefinition[] {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthEmailPasswordFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createAuthFoundationFeature(),
    createPersonalAccessTokensFeature({ scopes: {} }),
    createSessionsFeature(),
    createUserDataRightsFeature({
      deletionTokenSecret: opts.deletionTokenSecret,
      deletionVerifyUrl: opts.deletionVerifyUrl,
      sendDeletionVerificationEmail: opts.sendDeletionVerificationEmail,
    }),
  ];
}

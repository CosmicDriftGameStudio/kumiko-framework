// apex-surface-auth Recipe — der evidente Weg für öffentlichen Apex-Content.
//
// Eine Kumiko-App hat eine öffentliche Apex-Präsenz (Landing/Login) UND eine
// schema-getriebene Admin-UI. Die Admin-UI mountet via createKumikoApp (volles
// Schema). Die Apex mountet via createPublicSurface — schema-LOS, anonym
// erreichbar, kein Admin-Nav/Topologie-Leak. Beide teilen Locale + Primitives.
//
// Dieses Recipe zeigt:
//   1. Server: die Feature-Komposition für die 4 Account-Flows + den anonymen,
//      email-verifizierten Deletion-Flow (Lockout-sicher).
//   2. Client (Kommentar unten + README): wie createPublicSurface + AuthShell
//      die Screens in der Apex-Chrome mounten.
//
// CLIENT-WIRING (apex.tsx der App — renderer-web, hier nur als Referenz, da
// Recipes keine Browser-Deps ziehen):
//
//   import {
//     ForgotPasswordScreen, SignupScreen, createLoginRoute,
//     AuthShellProvider, emailPasswordClient,
//   } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
//   import {
//     RequestAccountDeletionScreen, ConfirmAccountDeletionScreen,
//     defaultTranslations as deletionI18n,
//   } from "@cosmicdrift/kumiko-bundled-features/user-data-rights/web";
//   import { createPublicSurface } from "@cosmicdrift/kumiko-renderer-web";
//
//   // AuthShell: die Auth-Card rendert in der Marketing-Chrome statt
//   // Fullscreen. Default (ohne Provider) bleibt der Fullscreen-Wrapper.
//   const shell = ({ children }) => (
//     <MarketingChrome>
//       <AuthShellProvider shell={(card) => <div className="py-12 flex justify-center">{card}</div>}>
//         {children}
//       </AuthShellProvider>
//     </MarketingChrome>
//   );
//
//   // createLoginRoute — NICHT LoginScreen direkt rendern: die Route
//   // braucht die Challenge-Swap-Logik für einen zweiten Faktor. Ohne die
//   // (z.B. raw <LoginScreen />) bleibt ein MFA-enrolter User beim Login
//   // hängen, sobald die App irgendwann auth-mfa mountet. Mountet die App
//   // auth-mfa, `mfaVerifyScreen: MfaVerifyScreen` (aus
//   // "@cosmicdrift/kumiko-bundled-features/auth-mfa/web") ergänzen.
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
// SERVER-WIRING: die App aktiviert `anonymousAccess` (defaultTenantId = der
// Apex-Host-Tenant), damit /api/write die anonymen Deletion-Handler erreicht:
//
//   runProdApp({ features: composeApexAccountApp({...}),
//                anonymousAccess: { defaultTenantId: APEX_TENANT_ID } })

import { createAuthEmailPasswordFeature } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
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
  /** HMAC-Secret für das Deletion-Verify-Token. */
  readonly deletionTokenSecret: string;
  /** Apex-Route des Confirm-Screens; der Handler hängt `?token=` an. */
  readonly deletionVerifyUrl: string;
  /** Versand des Verify-Magic-Links. MUSS non-blocking sein (enqueue) — ein
   *  synchroner Send würde ein Timing-Oracle für Account-Enumeration öffnen. */
  readonly sendDeletionVerificationEmail: SendDeletionVerificationEmailFn;
};

// Volle Feature-Komposition für die öffentlichen Account-Flows. Die
// user-data-rights-Options aktivieren den anonymen Deletion-Flow; die übrigen
// Features liefern Login/Register/PW (auth-email-password) + die
// Require-Kette (user-data-rights → data-retention + compliance-profiles +
// sessions).
export function composeApexAccountApp(opts: ApexAccountAppOptions): FeatureDefinition[] {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthEmailPasswordFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    authFoundationFeature,
    createPersonalAccessTokensFeature({ scopes: {} }),
    createSessionsFeature(),
    createUserDataRightsFeature({
      deletionTokenSecret: opts.deletionTokenSecret,
      deletionVerifyUrl: opts.deletionVerifyUrl,
      sendDeletionVerificationEmail: opts.sendDeletionVerificationEmail,
    }),
  ];
}

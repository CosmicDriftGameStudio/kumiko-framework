# apex-surface-auth

Der **evidente Weg für öffentlichen Apex-Content**: die 4 Account-Flows
(Login, Register, Passwort-vergessen, Konto-löschen) in der öffentlichen
Apex-Präsenz einer Kumiko-App — schema-los, anonym erreichbar, ohne
Admin-Nav/Topologie-Leak.

Eine App hat zwei Mounts, die Locale + Primitives teilen:

- **Admin-UI** → `createKumikoApp` (volles Schema, `injectSchema: true`)
- **Apex** → `createPublicSurface` (schema-LOS, `injectSchema: false`)

## Client: `createPublicSurface` + `AuthShell`

```tsx illustration
import {
  ForgotPasswordScreen, LoginScreen, SignupScreen,
  AuthShellProvider, emailPasswordClient,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  RequestAccountDeletionScreen, ConfirmAccountDeletionScreen,
} from "@cosmicdrift/kumiko-bundled-features/user-data-rights/web";
import { createPublicSurface } from "@cosmicdrift/kumiko-renderer-web";

createPublicSurface({
  clientFeatures: [emailPasswordClient()],   // SessionProvider + i18n
  // AuthShell: Auth-Card rendert in der Marketing-Chrome statt Fullscreen.
  // Ohne Provider bleibt der Default-Fullscreen-Wrapper (rückwärtskompatibel).
  shell: ({ children }) => (
    <MarketingChrome>
      <AuthShellProvider shell={(card) => <div className="py-12 flex justify-center">{card}</div>}>
        {children}
      </AuthShellProvider>
    </MarketingChrome>
  ),
  routes: [
    { path: "/login",           component: <LoginScreen /> },
    { path: "/signup",          component: <SignupScreen loginHref="/login" /> },
    { path: "/forgot-password", component: <ForgotPasswordScreen loginHref="/login" /> },
    { path: "/delete-account",         component: <RequestAccountDeletionScreen /> },
    { path: "/delete-account/confirm", component: <ConfirmAccountDeletionScreen /> },
  ],
  fallback: <LoginScreen />,
});
```

`createPublicSurface` stackt nur `providers` + `translations` der
`clientFeatures` — **nicht** ihre `gates`: ein AuthGate würde die öffentliche
Surface hinter Login sperren.

## Server: Komposition + `anonymousAccess`

`composeApexAccountApp()` (siehe `src/feature.ts`) komponiert die Features für
alle 4 Flows. Login/Register/PW liefert `auth-email-password`; den anonymen,
**email-verifizierten** Deletion-Flow liefert `user-data-rights`:

- `request-deletion-by-email` (anonym, enumeration-safe) → Magic-Link
- `confirm-deletion-by-token` (anonym) → startet die Grace-Period

Damit `/api/write` die anonymen Handler erreicht, aktiviert die App
`anonymousAccess` mit dem Apex-Host-Tenant als Default:

```ts illustration
runProdApp({
  features: composeApexAccountApp({
    deletionTokenSecret: process.env.DELETION_TOKEN_SECRET,
    deletionVerifyUrl: "https://app.example.com/delete-account/confirm",
    sendDeletionVerificationEmail: async ({ email, verifyUrl }) => {
      // MUSS non-blocking sein (enqueue) — synchroner Send öffnet ein
      // Timing-Oracle für Account-Enumeration.
      await delivery.notify("account.deletion.verify", { email, verifyUrl });
    },
  }),
  anonymousAccess: { defaultTenantId: APEX_TENANT_ID },
});
```

## Warum der Deletion-Flow anonym ist

DSGVO Art. 17 greift gerade dann, wenn der User sich **nicht mehr einloggen**
kann (Lockout). Der Flow ist email-verifiziert (Magic-Link) statt login-gated.
Das HMAC-Token trägt `userId` + Expiry selbst (kein DB-Table/Redis), Purpose
`"deletion-request"` verhindert Replay gegen andere Token-Endpoints. Zweites
Confirm ist idempotent (`user_not_in_active_state`).

Der Integration-Test (`src/__tests__/feature.integration.test.ts`) beweist den
Flow end-to-end über echtes `/api/write` ohne Auth.

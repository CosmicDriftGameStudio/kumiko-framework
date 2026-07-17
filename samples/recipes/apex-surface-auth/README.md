# apex-surface-auth

The **standard pattern for public apex auth**: login, signup, forgot-password,
and account-deletion on your marketing surface — schema-less, anonymously
reachable, without leaking admin nav or internal topology.

A typical app has two mounts sharing locale and primitives:

- **Admin UI** → `createKumikoApp` (full schema, `injectSchema: true`)
- **Apex** → `createPublicSurface` (no schema, `injectSchema: false`)

## What it shows

- **Four public routes** — `/login`, `/signup`, `/forgot-password`,
  `/delete-account` (+ confirm) using bundled auth screens.
- **`createPublicSurface`** — stacks `clientFeatures` providers and i18n only,
  **not** their gates (an `AuthGate` would lock the public surface).
- **`AuthShellProvider`** — auth card inside marketing chrome instead of
  fullscreen (optional; default fullscreen still works).
- **`composeApexAccountApp()`** — server feature list for all four flows.
- **Anonymous deletion** — email-verified magic-link flow when the user cannot
  log in (GDPR Art. 17 lockout case).
- **`anonymousAccess`** — lets unauthenticated `/api/write` hit anonymous
  handlers on the apex host tenant.

## Client: `createPublicSurface` + `AuthShell`

```tsx illustration
import {
  ForgotPasswordScreen, SignupScreen, createLoginRoute,
  AuthShellProvider, emailPasswordClient,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  RequestAccountDeletionScreen, ConfirmAccountDeletionScreen,
} from "@cosmicdrift/kumiko-bundled-features/user-data-rights/web";
import { createPublicSurface } from "@cosmicdrift/kumiko-renderer-web";

// createLoginRoute, not a raw LoginScreen render — it owns the challenge-
// swap for a second factor, so mounting auth-mfa later doesn't need this
// route touched again. Pass `mfaVerifyScreen: MfaVerifyScreen` (from
// `.../auth-mfa/web`) once the app mounts auth-mfa.
const LoginRoute = createLoginRoute({ loginScreenProps: { signupHref: "/signup" } });

createPublicSurface({
  clientFeatures: [emailPasswordClient()],   // SessionProvider + i18n
  shell: ({ children }) => (
    <MarketingChrome>
      <AuthShellProvider shell={(card) => <div className="py-12 flex justify-center">{card}</div>}>
        {children}
      </AuthShellProvider>
    </MarketingChrome>
  ),
  routes: [
    { path: "/login",           component: <LoginRoute /> },
    { path: "/signup",          component: <SignupScreen loginHref="/login" /> },
    { path: "/forgot-password", component: <ForgotPasswordScreen loginHref="/login" /> },
    { path: "/delete-account",         component: <RequestAccountDeletionScreen /> },
    { path: "/delete-account/confirm", component: <ConfirmAccountDeletionScreen /> },
  ],
  fallback: <LoginRoute />,
});
```

## Server: composition + `anonymousAccess`

`composeApexAccountApp()` (see `src/feature.ts`) mounts features for all four
flows. Login/signup/password reset come from `auth-email-password`; the
anonymous **email-verified** deletion flow from `user-data-rights`:

- `request-deletion-by-email` (anonymous, enumeration-safe) → magic link
- `confirm-deletion-by-token` (anonymous) → starts grace period

```ts illustration
runProdApp({
  features: composeApexAccountApp({
    deletionTokenSecret: process.env.DELETION_TOKEN_SECRET!,
    deletionVerifyUrl: "https://app.example.com/delete-account/confirm",
    sendDeletionVerificationEmail: async ({ email, verifyUrl }) => {
      // Must be non-blocking (enqueue) — synchronous send enables timing oracle.
      await delivery.notify("account.deletion.verify", { email, verifyUrl });
    },
  }),
  anonymousAccess: { defaultTenantId: APEX_TENANT_ID },
});
```

## Why deletion is anonymous

GDPR Art. 17 applies when the user **cannot log in** (lockout). The flow is
email-verified (magic link), not login-gated. The HMAC token carries `userId`
+ expiry (no DB table); purpose `"deletion-request"` blocks replay on other
token endpoints. Second confirm is idempotent (`user_not_in_active_state`).

## Tests

```bash
bun test src/__tests__/feature.integration.test.ts
```

Proves end-to-end over real `/api/write` without auth:

1. `request-deletion-by-email` → verification email enqueued
2. `confirm-deletion-by-token` → user status `DeletionRequested`
3. Unknown email → same 200 response, no mail (enumeration-safe)

## Related samples

- [user-profile](/en/samples/recipes-user-profile/) — logged-in self-service
  profile (password, email, deletion while authenticated).
- [session-revocation](/en/samples/recipes-session-revocation/) — wire
  `createSessionCallbacks()` so logout invalidates JWTs server-side.

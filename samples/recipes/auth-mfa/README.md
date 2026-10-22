# Sample: Auth MFA (TOTP/2FA)

**I want users to be able to enable TOTP-based 2FA, and login to become a two-step challenge once they have.**

## What this sample shows

The production wiring shape: mount `createAuthMfaFeature()` next to `createAuthEmailPasswordFeature()`, thread its status-checker into the login handler, and give `auth: { mfaVerifyHandler: ... }` to `buildServer`. From there the framework handles the rest — a password-only login for an MFA-enrolled user returns a challenge token instead of a JWT, and `POST /auth/mfa/verify` completes it with a TOTP or recovery code.

## The wiring in 4 sentences

1. `createAuthMfaFeature({ setupTokenSecret, challengeTokenSecret, issuer })` builds the feature; `mfaStatusCheckerFromFeature(mfaFeature)` reads its login-status callback back off.
2. That callback goes into `createAuthEmailPasswordFeature({ mfaStatusChecker: ... })` — `login.write.ts` calls it after the password check to decide whether to mint a JWT or a challenge.
3. `buildServer({ auth: { mfaVerifyHandler: AuthMfaHandlers.verify, switchTenantMfaGateHandler: AuthHandlers.switchTenantMfaGate } })` (the gate is required with `mfaVerifyHandler`, so a tenant switch asks for the second factor too) mounts `POST /auth/mfa/verify`, a framework route (not a dispatcher write-handler) with its own rate limiter, since it runs before a JWT exists.
4. If `sessions` is mounted too, `bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature)?.(sessionCallbacks.sessionRevokeAllOthers)` wires "enable/disable/regenerate signs out every other session."

## What to copy into your app

```ts illustration
const mfaFeature = createAuthMfaFeature({
  setupTokenSecret: config.mfaSetupSecret,
  challengeTokenSecret: config.mfaChallengeSecret,
  issuer: "Your App",
});
const sessionCallbacks = createSessionCallbacks({ db });
bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature)?.(
  sessionCallbacks.sessionRevokeAllOthers,
);

const server = buildServer({
  registry: buildRegistry([
    createAuthEmailPasswordFeature({
      mfaStatusChecker: mfaStatusCheckerFromFeature(mfaFeature),
    }),
    createSessionsFeature({
      autoRevokeOnPasswordChange: sessionCallbacks.sessionMassRevoker,
    }),
    mfaFeature,
    // ... other features
  ]),
  context: { db, /* ... */ },
  jwtSecret: process.env.JWT_SECRET,
  auth: {
    membershipQuery: "tenant:query:memberships",
    loginHandler: "auth-email-password:[REDACTED:API key param]",
    mfaVerifyHandler: AuthMfaHandlers.verify,
    switchTenantMfaGateHandler: AuthHandlers.switchTenantMfaGate,
    sessionCreator: sessionCallbacks.sessionCreator,
    sessionRevoker: sessionCallbacks.sessionRevoker,
    sessionChecker: sessionCallbacks.sessionChecker,
  },
});
```

Apps built via `runDevApp`/`runProdApp` (the dev-server bootstrap used by `create-kumiko-app`) get all of this automatically — just add `createAuthMfaFeature(...)` to `APP_FEATURES`. `composeFeatures` threads the status-checker and the bootstrap wires the session-revoke bind and the verify route for you. This sample shows the raw contract those helpers implement.

## Self-service screen

`createAccountSecurityFeature({ nav?, access? })` adds one screen,
`account-security:screen:account-security`, that embeds the MFA enable,
regenerate and disable screens plus the own-sessions list. It owns no handlers
and needs no `composeAuthStack`: mount it next to `auth-mfa` and `sessions`.
Without `nav` the screen stays dormant (reachable by its route, no sidebar
entry); `access` defaults to every signed-in user.

```ts illustration
features: [..., createSessionsFeature(), mfaFeature, createAccountSecurityFeature({ nav: { order: 90 } })]
```

## Design rules

1. **Enrollment is stateless until confirmed.** `enable-start` returns a signed setup token (QR + secret + 8 recovery codes) — nothing is persisted until `enable-confirm` proves the user scanned it with a valid TOTP code.
2. **The TOTP secret is envelope-encrypted at rest**, same `MasterKeyProvider` as `secrets`/`config` — no separate crypto story to maintain.
3. **`/auth/mfa/verify` is a framework route, not a dispatcher handler.** It runs before a JWT exists, so it gets its own IP-keyed rate limiter (`mfaVerifyRateLimit`), independent of the login rate limiter.
4. **Recovery codes are single-use.** Each of the 8 generated codes completes exactly one login challenge, then it's burned.
5. **MFA state changes revoke every OTHER live session** (stolen-session defense) — never the session that made the change.
6. **Enforcement is opt-in.** Without a tenant enabling `auth-mfa:config:required`, users choose for themselves whether to enroll.

## Confirmation code input

`src/web/confirmation-code-step.tsx` shows the `Input kind="code"` renderer primitive outside the MFA screen, for example an e-mail or invite confirmation code. Pass `length` (here 6), `autoFocus` and `onComplete`. The input accepts digits only, so pasting "123 456" yields `123456`, and `onComplete` fires once when the value reaches `length`. `autoComplete` defaults to `one-time-code`, so mobile keyboards offer the code from the SMS or mail. After a wrong code the step clears the value and bumps a `key`, which remounts the input and returns focus to it.

## Tests

- **Baseline:** a user without MFA enrolled still gets a JWT straight from `/auth/login`.
- **End-to-end:** enroll via `enable-start`/`enable-confirm`, log in (gets a challenge, no JWT), complete via `/auth/mfa/verify` (gets a JWT) — copies the `buildServer({ auth: ... })` block from the sample comment verbatim.
- **Account security:** the composed screen boot-validates next to `auth-mfa` and `sessions` and shows a sidebar entry once `nav` is set.
- **Confirmation code step:** typing or pasting six digits calls `onConfirm` once; a rejected code shows the error, clears the field and refocuses it.

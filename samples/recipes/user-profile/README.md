# user-profile

Self-service account page as a bundled feature: change password, change email
(with re-auth + verification reset), and request or cancel account deletion
(with grace period from `user-data-rights`).

The bundled feature ships the `profile` screen itself (a declarative
`projectionDetail`, fw#2312) plus handlers and i18n. **Your app** only points
a nav entry at it and registers the two extension-section components
(change-password, change-email — re-auth flows a declarative action can't
express) — this recipe shows the wiring.

## What it shows

- **`user-profile:write:change-email`** — re-authenticated email change;
  resets `emailVerified` until the user confirms the new address.
- **`auth-email-password:write:change-password`** — used from the same
  screen; lives on `auth-email-password`, not duplicated in user-profile.
- **Account deletion** — `user-data-rights` handlers for request / cancel
  deletion; grace period comes from the tenant's compliance profile.
- **App-side nav wiring only** — `r.nav({ screen: "user-profile:screen:profile", ... })`;
  no `r.screen()` registration needed, the bundled feature owns the screen.
- **Full require chain** — `user` → `tenant` → `auth-email-password` →
  `user-data-rights` (which pulls `data-retention`, `compliance-profiles`,
  `sessions`). `composeAccountApp()` mounts everything boot needs.

## Feature composition

```
user               → cross-tenant identity (email, roles, status)
tenant             → memberships + tenant-scoped roles
auth-email-password → login + change-password handlers
data-retention     → retention policies (via user-data-rights)
compliance-profiles → region profiles for grace periods
sessions           → revocable JWTs (via user-data-rights chain)
user-data-rights   → deletion request / export pipeline
user-profile       → declarative `profile` screen + change-email handler
account            → this recipe: nav wiring only
```

## Client wiring

Register the two extension-section components once at app boot (the screen
itself needs no client registration):

```tsx illustration
import { userProfileClient } from "@cosmicdrift/kumiko-bundled-features/user-profile/web";
import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";

createKumikoApp({
  clientFeatures: [emailPasswordClient(), userProfileClient()],
  // ... schema, nav from server features
});
```

## Flow

1. User opens the profile nav entry → renderer loads the declarative `profile`
   screen.
2. Password change dispatches `auth-email-password:write:change-password`.
3. Email change dispatches `user-profile:write:change-email` (re-auth required).
4. Delete account dispatches `user-data-rights:write:request-deletion`; cancel
   uses the matching cancel handler during the grace window.

## Tests

Boot validation only — no DB/HTTP in this recipe (HTTP proof lives in the
bundled-feature integration tests):

```bash
bun test src/__tests__/feature.test.ts
```

The test asserts `validateBoot(composeAccountApp())` passes, the profile
screen/nav are registered, and the documented change-email qualified name
matches `UserProfileHandlers.changeEmail`.

## Related samples

- [apex-surface-auth](/en/samples/recipes-apex-surface-auth/) — public login/
  signup on the marketing apex (no admin nav).
- [user-data-rights](/en/samples/recipes-user-data-rights/) — `EXT_USER_DATA`
  hooks for export/forget on your domain entities.
- [apps-user-data-rights-demo](/en/samples/apps-user-data-rights-demo/) —
  full runnable app with todos + export ZIP.

# user-profile

Self-service account page as a bundled feature: change password, change email
(with re-auth + verification reset), and request or cancel account deletion
(with grace period from `user-data-rights`).

The bundled feature ships handlers, `ProfileScreen`, and i18n. **Your app**
declares the screen in nav and registers the React component — this recipe
shows the wiring.

## What it shows

- **`user-profile:write:change-email`** — re-authenticated email change;
  resets `emailVerified` until the user confirms the new address.
- **`auth-email-password:write:change-password`** — used from the same
  screen; lives on `auth-email-password`, not duplicated in user-profile.
- **Account deletion** — `user-data-rights` handlers for request / cancel
  deletion; grace period comes from the tenant's compliance profile.
- **App-side screen declaration** — `r.screen({ type: "custom", renderer:
  { react: { __component: "UserProfileScreen" } } })` plus matching
  `components` map on the client.
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
user-profile       → change-email handler + ProfileScreen component
account            → this recipe: screen + nav wiring only
```

## Client wiring

Register the bundled screen once at app boot:

```tsx illustration
import { ProfileScreen, userProfileClient } from "@cosmicdrift/kumiko-bundled-features/user-profile/web";
import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";

createKumikoApp({
  components: { UserProfileScreen: ProfileScreen },
  clientFeatures: [emailPasswordClient(), userProfileClient()],
  // ... schema, nav from server features
});
```

The `__component: "UserProfileScreen"` string on the server screen must match
the key in `components`.

## Flow

1. User opens the profile nav entry → renderer loads `ProfileScreen`.
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

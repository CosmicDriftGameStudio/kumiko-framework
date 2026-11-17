---
status: reference
verified: 2026-11-17
---

# First-run admin in prod

`seeds.bootstrapAdminFromEnv` creates the first admin on the first boot, without a password. No password lives in env, a secret or the image. The admin sets a password through the password-reset link sent to their address. A mistyped address gives no access to anyone who cannot read that mailbox. You do not need `auth.admin` (the password seed) for this.

## Setup

```ts illustration
await runProdApp({
  features: APP_FEATURES,
  envSchema,
  mail: { transport: "smtp-env" },
  auth: {
    passwordReset: { appUrl: `${appBaseUrl}${DEFAULT_AUTH_PATHS.resetPassword}` },
  },
  seeds: {
    bootstrapAdminFromEnv: {
      tenant: { id: DEFAULT_TENANT_ID, key: "acme", name: "Acme GmbH" },
    },
  },
});
```

Set `KUMIKO_BOOTSTRAP_ADMIN_EMAIL` to the admin's address. Without the variable the seed does nothing.

Without `tenant`, the seed uses `seeds.demoTenant`. Without `tenant.id`, it reads `DEMO_TENANT_ID`.

The password reset and the mail delivery must be wired. Otherwise the admin can never sign in.

## What the seed creates

- The roles `Admin` and `TenantAdmin` in the tenant (option `roles`).
- The global role `SystemAdmin` (option `globalRoles`).
- `emailVerified: true` (option `emailVerified`).
- A `displayName`.

With `ensureRoles: true`, every boot adds missing `roles` to the existing membership. It never removes one.

## Running it again

| State | What happens |
|---|---|
| `KUMIKO_BOOTSTRAP_ADMIN_EMAIL` is not set | nothing |
| The account has no password and the tenant has no other members | the account is completed |
| The account has a password, or the tenant has other members | skipped |

## Per-tenant config

Keys that only the system may write, such as `auth-mfa:config:required`, are set from a `seeds.run` function as a system write:

```ts illustration
import { ConfigHandlers } from "@cosmicdrift/kumiko-bundled-features/config";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";

await dispatcher.write(
  ConfigHandlers.set,
  { key: "auth-mfa:config:required", value: "admins", scope: "tenant" },
  createSystemUser(tenantId, ["SystemAdmin"]),
);
```

Seeds run on every boot, and `config:write:set` writes an unchanged value as a new event too. The function therefore checks first whether the value is already set.

The app-wide default comes from `createAuthMfaFeature({ requiredPolicy })`.

`auth-mfa:config:required` takes one of four policies. Users it covers must set up a second factor at their next login:

| Policy | Who must use MFA |
|---|---|
| `"optional"` (default) | nobody |
| `"systemAdmins"` | users with the global `SystemAdmin` role |
| `"admins"` | `SystemAdmin`, `TenantAdmin` and `Admin` |
| `"all"` | every user of the tenant |

`"systemAdmins"` fits an operator tenant whose staff runs the platform while the
customers in the other tenants keep MFA optional.

Users set up their second factor on the account security page. Without a
`nav` option that page stays out of the sidebar and the app links to it from
its user menu. With `nav` it gets a sidebar entry with the `user` icon;
`nav.icon` takes any nav icon key:

```ts illustration
createAccountSecurityFeature({ nav: { icon: "shield-check", order: 90 } });
```

## One-shot scripts and required env vars

Build your own one-shot script, for example a remote probe, with `kumiko-build --entry bin/remote-probe.ts` (repeatable) or `buildServerBundle({ extraEntries })`. It lands as `dist-server/<basename>.js` and shares the framework chunks.

Such a script often reads env vars the framework does not know about. `requiredEnvFor` from `@cosmicdrift/kumiko-framework/env`
returns a reader that fails with a message naming the script and the variable:

```ts illustration
import { requiredEnvFor } from "@cosmicdrift/kumiko-framework/env";

const requireEnv = requiredEnvFor("remote-probe", process.env);
const probeToken = requireEnv("REMOTE_PROBE_TOKEN");
// missing: Error "[remote-probe] required env var REMOTE_PROBE_TOKEN is missing or empty"
```

An empty string counts as missing, so `FOO=` in a manifest fails as early as
an unset variable. The error names the variable, never its value.

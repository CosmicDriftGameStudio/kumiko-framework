---
status: reference
verified: 2026-10-26
---

# Passwordless first-run bootstrap in prod

`runBootstrap` provisions a fresh deployment once: it creates the listed
tenants and mails invitations. No password ever lives in env, a secret or the
image. SystemAdmins get their global role only when they accept the
invitation, so a leaked or mistyped address never holds platform access on its
own.

`runProdApp` no longer needs `auth.admin`. Keep it only if you still want the
legacy password seed.

## Entry point

Create `bin/bootstrap.ts` next to `bin/server.ts`. `buildServerBundle` picks it
up and emits `dist-server/bootstrap.js`. Any other one-shot script (for
example a remote probe) is bundled the same way when you pass it to
`kumiko-build --entry bin/remote-probe.ts` (repeatable) or to
`buildServerBundle({ extraEntries })`; it lands as `dist-server/<basename>.js`
and shares the framework chunks.

```ts illustration
import { runBootstrap } from "@cosmicdrift/kumiko-server-runtime";
import { appFeatures, authOptions, kmsSlots } from "../src/server-config";

await runBootstrap({
  features: appFeatures,
  kmsSlots,            // same crypto wiring as the API process
  auth: authOptions,   // same block as runProdApp; needs auth.mail + SMTP_HOST or auth.invite
  tenants: [
    {
      id: "8c0e…" as TenantId,
      key: "acme",
      name: "Acme GmbH",
      invites: [{ email: "office@acme.example", role: "TenantAdmin" }],
      // per-tenant config, set as system writes on every run
      config: { "auth-mfa:config:required": "admins" },
    },
  ],
  systemAdmins: [{ email: "ops@example.com", tenantId: "8c0e…" as TenantId, role: "TenantAdmin" }],
  seed: async ({ tenantId, dispatchSystemWrite }) => {
    // runs only in the run that creates the tenant
  },
});
```

Pass the same `features`, `kmsSlots`, `kms`, `blindIndexKey` and `masterKey` as
the API process. Otherwise the job writes rows the API cannot decrypt.

## Running it

Run it as a one-off Kubernetes Job with the API's image, env and secrets. Use
the command `bun dist-server/bootstrap.js`. The process exits on its own and
logs one line per tenant and per invitation, with the email masked.

1. Apply the migrations first. The job refuses to run on schema drift, like the
   worker does.
2. Dry run: set `KUMIKO_DRY_RUN_ENV=boot`. This validates the composed registry
   and env without opening a connection. With `auth.mail`, `SMTP_HOST` must be
   set for the dry run too, because the job refuses to start without an invite
   flow.
3. Run the job, then check that the invitation mails arrived.
4. Delete the job, or keep the manifest for the next run.

## Running it again

The same plan can run again safely:

| State | What happens |
|---|---|
| tenant exists | nothing; the `seed` hook does not run |
| `config` value differs from the stored one (also on an existing tenant) | written, listed as `config: <key>` in the log |
| `config` value already matches | nothing is written |
| invitation pending (link still valid) | `pending`, no mail |
| invitation expired unused | `resent`, a new link goes out |
| open invitation still carries a global role the plan no longer lists | `resent`, the old link stops working and the new one carries the planned roles |
| invitation accepted, or the user already has access | `active`, no mail |
| invitation cancelled by an admin | `cancelled`, nothing is re-sent |
| a tenant admin re-invited the address without the planned SystemAdmin role | `role-mismatch`, nothing is sent; decide by hand |

`config` is declarative and converges on every run, so a later run also changes
a value you edited in the plan. Keys that only the system may write (for example
`auth-mfa:config:required`) can be set this way and nowhere else. Encrypted
and PII-encrypted keys are compared by their decrypted value, so an unchanged
value is not rewritten.

`auth-mfa:config:required` takes one of four policies. Users it covers must set
up a second factor at their next login:

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

A seed that fails after the tenant was created is not retried by a second run.
Fix the data through the app or a migration instead.

To add a tenant or a person later, extend the plan and run the job again.

## Required env vars in your own scripts

A bootstrap script or a remote probe often reads env vars the framework does
not know about. `requiredEnvFor` from `@cosmicdrift/kumiko-framework/env`
returns a reader that fails with a message naming the script and the variable:

```ts illustration
import { requiredEnvFor } from "@cosmicdrift/kumiko-framework/env";

const requireEnv = requiredEnvFor("bootstrap", process.env);
const operatorEmail = requireEnv("BOOTSTRAP_OPERATOR_EMAIL");
// missing: Error "[bootstrap] required env var BOOTSTRAP_OPERATOR_EMAIL is missing or empty"
```

An empty string counts as missing, so `FOO=` in a manifest fails as early as
an unset variable. The error names the variable, never its value.
